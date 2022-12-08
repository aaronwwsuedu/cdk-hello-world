import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';

interface HelloWorldAppStackProps extends cdk.StackProps {
  default_vpc_id: string;

  efsFs: efs.IFileSystem;
  gitrepo: codecommit.IRepository;
  docker_repository: ecr.IRepository;
  
  loggroup: logs.ILogGroup;
  ssmEnvParam: ssm.IParameter;
  secretManagerEnvSecret: secrets.ISecret;

  ecsCluster: ecs.ICluster;
  ecsCapacityProvider: ecs.AsgCapacityProvider;

  source_artifact: codepipeline.Artifact;
  build_artifact: codepipeline.Artifact;
};

//
// The app stack defines the application, defines pipelines to build it, and defines the load balancer to present it.
//
export class HelloWorldAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HelloWorldAppStackProps) {
    super(scope, id, props);

    // WSU uses a peering account to define the VPC. use the default_vpc_id to define the VPC object
    const default_vpc = ec2.Vpc.fromLookup(this,'DefaultVpc',{ vpcId: props.default_vpc_id})
    // create a pipeline to automatically rebuild and redeploy container when repository is updated.

    const pipeline = new codepipeline.Pipeline(this,'HelloWorldPipeline',{
      pipelineName: 'HelloWorldPipeline',
      crossAccountKeys: false,
    });
    const sourceStage = pipeline.addStage({ stageName: 'Source'});
    const buildStage = pipeline.addStage({ stageName: 'Build'})

    sourceStage.addAction(new cdk.aws_codepipeline_actions.CodeCommitSourceAction({
      actionName: 'Source', output: props.source_artifact, repository: props.gitrepo, branch: 'main'
    }));

    const pipelineProject = new codebuild.PipelineProject(this,'HelloWorldBuilder',{
      projectName: "HelloWorldPipelineBuild",
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        artifacts: {
          files: [ 'imagedefinitions.json' ]
        },
        phases: {
          pre_build: {
            commands: [
              "$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)",
              "COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)",
              "IMAGE_TAG=${COMMIT_HASH:=latest}"
            ],
          },
          build: {
            commands: [
              "docker build -t $REPOSITORY_URI:latest .",
              "docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG"
            ],
          },
          post_build: {
            commands: [
              "docker push $REPOSITORY_URI:latest",
              "docker push $REPOSITORY_URI:$IMAGE_TAG",
              "printf '[{\"name\":\"%s\",\"imageUri\":\"%s\"}]' $ECS_CONTAINER_NAME $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json"
            ],
          }
        }
      }),
      environmentVariables: {
        REPOSITORY_URI: { value: props.docker_repository.repositoryUri },
        ECS_CONTAINER_NAME: { value: 'HelloWorld' }
      },
      environment: {
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_1_0,
        
      },
      timeout: cdk.Duration.minutes(5),
    }); 

    buildStage.addAction(new cdk.aws_codepipeline_actions.CodeBuildAction({
      actionName: 'HelloWorldDockerBuildImages',
      input: props.source_artifact,
      outputs: [ props.build_artifact ],
      project: pipelineProject,
    }))
    // allow the build to write to ECR.
    props.docker_repository.grantPullPush(pipelineProject)
    
    // define a task to run our service. this doesn't run the service, it only defines it
    const HelloWorldTaskDefn = new ecs.TaskDefinition(this,'HelloWorldTaskDefn',{
      compatibility: ecs.Compatibility.EC2,
      memoryMiB: '512',
      cpu: '128',
      networkMode: ecs.NetworkMode.AWS_VPC, // AWS_VPC networking means the container gets to use security groups.
    });
    // add the container to the task, including any environment variables we want to push in to the docker runtime
    const container = HelloWorldTaskDefn.addContainer('HelloWorldContainer',{
      containerName: 'HelloWorld',
      image: ecs.ContainerImage.fromEcrRepository(props.docker_repository,'latest'),
      environment: {
        'TEST_ENV_VAR': 'Hard-coded-string',
      },
      secrets: {
        'TEST_SECRET_VAR': ecs.Secret.fromSecretsManager(props.secretManagerEnvSecret),
        'TEST_SSM_VAR': ecs.Secret.fromSsmParameter(props.ssmEnvParam),
      },
      essential: true,
      memoryLimitMiB: 512,
      // allowing the container to write to its own ephemeral filesystem will generate a finding, but apache expects to be able 
      // to write temporary and pid files.
      //readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ 
        logGroup: props.loggroup,
        streamPrefix: 'HelloWorld',
        mode: ecs.AwsLogDriverMode.NON_BLOCKING}), // send container logs to cloudwatch
      portMappings: [ 
        { containerPort: 80 }
      ],
      stopTimeout: cdk.Duration.seconds(15),
      startTimeout: cdk.Duration.seconds(40),
      // command
      // healthCheck
    });

    HelloWorldTaskDefn.addVolume({
      name: 'efs',
      efsVolumeConfiguration: {
        fileSystemId: props.efsFs.fileSystemId,
        transitEncryption: 'ENABLED'
      }
    })
    // and then add the volume as a mount point
    container.addMountPoints({   
      sourceVolume: 'efs',
      containerPath: '/usr/local/apache2/htdocs/efs',
      readOnly: true,
    });

    // create the service. The service runs the task definition. IN our case, we want the service to be highly available, so we'll run at least two instances.
    const HelloWorldService = new ecs.Ec2Service(this,'HelloWorldService',{
      serviceName: "HelloWorldService",
      cluster: props.ecsCluster,
      taskDefinition: HelloWorldTaskDefn,
      desiredCount: 2,
      capacityProviderStrategies: [
        {
          capacityProvider: props.ecsCapacityProvider.capacityProviderName,
          weight: 1
        }
      ],
      enableECSManagedTags: true,
      placementStrategies: [ ecs.PlacementStrategy.spreadAcross('attribute:ecs.availability-zone'), ecs.PlacementStrategy.packedByMemory() ],
    });
    // make sure the service goes away when we kill the CfnStack
    HelloWorldService.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)

    // we need to explicity grant SG access from the hello world service to the EFS volume
    HelloWorldService.connections.allowToDefaultPort(props.efsFs)

    // create a load balancer to present the application
    const HelloWorldLB = new elb2.ApplicationLoadBalancer(this,'HelloWorldLB',{
      loadBalancerName: "HelloWorldAlb",
      vpc: default_vpc,
      internetFacing: true,
      deletionProtection: false,
      dropInvalidHeaderFields: true,
    });

    // update the codepipeline to update the service when we finish a build
    const deployStage = pipeline.addStage({stageName: 'Deploy'})
    deployStage.addAction(
      new cdk.aws_codepipeline_actions.EcsDeployAction({
        actionName: "DeployAction",
        service: HelloWorldService,
        input: props.build_artifact,
      })
    );

    const httpListener = HelloWorldLB.addListener('httpListener',{
      port: 80,
      protocol: elb2.ApplicationProtocol.HTTP,
      open: true,
    });
    const httpTargetGroup = httpListener.addTargets('HelloWorldTarget',{
      port: 80,
      targets: [
        HelloWorldService.loadBalancerTarget({
          containerName: 'HelloWorld',
          containerPort: 80
        })
      ],
      healthCheck: {
        path: '/'
      }
    });
    
    // to test your service, you need to know where to go. output the lb name so it is visible
    const lbName = new cdk.CfnOutput(this,'lbName',{ value: HelloWorldLB.loadBalancerDnsName, exportName: 'HelloWorldLBName' });
    // TODO: send load balancer logs to S3!
    //  cloudwatch log organization
  }
}
