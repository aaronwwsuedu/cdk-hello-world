import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import { CodePipeline } from 'aws-cdk-lib/aws-events-targets';
import { CodeBuildAction, CodeDeployEcsDeployAction } from 'aws-cdk-lib/aws-codepipeline-actions';

var path = require('path');

interface HelloWorldStackProps extends cdk.StackProps {
  default_vpc_id: string;
  admin_access_nets: string[];
  ssh_access_key_name: string;
  ec2_instance_size: string;
};

// Note: this class defines the entire workload. Best programming practices should apply here, it's better to break up this
// giant class into components (make the code-deploy a class, etc etc)
export class HelloWorldStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HelloWorldStackProps) {
    super(scope, id, props);

    // Record the path of the SSM parameter that contains the current Amazon Linux 2 AMI
    const aws_ami_ssm_path = '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2'

    // WSU uses a peering account to define the VPC. use the default_vpc_id to define the VPC object
    const default_vpc = ec2.Vpc.fromLookup(this,'DefaultVpc',{ vpcId: props.default_vpc_id})

    // create a key we will use to encrypt a cloudwatch group.
    //const kms_cloudwatch_key = new kms.Key(this,'helloWorldCWKey',{
    //  enableKeyRotation: true,
    //});
    //kms_cloudwatch_key.addAlias('alias/helloWorldCWKey');

    // create the group too.
    const loggroup = new logs.LogGroup(this,'HelloCWLogs',{
      //encryptionKey: new kms.Key(this,'helloWorldCWKey'),
      retention: logs.RetentionDays.SIX_MONTHS,
    });

    // create a docker repository to store our test docker container image. 
    const docker_repository = new ecr.Repository(this,'helloWorldECRepo',{
      encryption: ecr.RepositoryEncryption.AES_256,
      repositoryName: 'helloworldrepo',
      // image scan on push at the repository level is depreciated, accounts should instead set a scan policy at the registry
      // level to apply to all repositories, but if leaving this unset or false will generate a Security Hub Finding.
      imageScanOnPush: true, 
    });
    // add lifecycle rules to automatically remove old images. This improves our security posture by removing stale data, and reduces our
    // Amazon Inspector costs by reducing the number of images to scan.
    docker_repository.addLifecycleRule({
      description: "Maintain no more than 5 tagged images",
      maxImageCount: 5,
      tagStatus: ecr.TagStatus.ANY,
    }),
    docker_repository.addLifecycleRule({
      description: "Restrict repo to 1 untagged image",
      maxImageCount: 1,
      tagStatus: ecr.TagStatus.UNTAGGED
    })



    // create a git repo to store the Dockerfile for our hello world container
    const gitrepo = new codecommit.Repository(this,'helloWorld',{
      repositoryName: 'HelloWorld',
      description: "Hello World demo container source",
      code: codecommit.Code.fromDirectory(path.join(__dirname,'..','hello-world-container')),
      
    });

    // create a pipeline to automatically rebuild and redeploy container when repository is updated.
    const source_output = new codepipeline.Artifact('HelloWorldSourceArtifact');
    const build_output = new codepipeline.Artifact('HelloWorldBuildArtifact');

    const pipeline = new codepipeline.Pipeline(this,'HelloWorldPipeline',{
      pipelineName: 'HelloWorldPipeline',
      crossAccountKeys: false,
    });
    const sourceStage = pipeline.addStage({ stageName: 'Source'});
    const buildStage = pipeline.addStage({ stageName: 'Build'})

    sourceStage.addAction(new cdk.aws_codepipeline_actions.CodeCommitSourceAction({
      actionName: 'Source', output: source_output, repository: gitrepo, branch: 'main'
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
        REPOSITORY_URI: { value: docker_repository.repositoryUri },
        ECS_CONTAINER_NAME: { value: 'helloWorld' }
      },
      environment: {
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        
      },
      timeout: cdk.Duration.minutes(5),
    }); 

    buildStage.addAction(new cdk.aws_codepipeline_actions.CodeBuildAction({
      actionName: 'HelloWorldDockerBuildImages',
      input: source_output,
      outputs: [ build_output ],
      project: pipelineProject,
    }))
    // allow the build to write to ECR.
    docker_repository.grantPullPush(pipelineProject)


    // create a systems manager parameter to store a value
    const ssmEnvParam = new ssm.StringParameter(this,'helloWorldSsmParam',{
      description: "a parameter needed by hello world",
      parameterName: '/helloworld/development/test_ssm_param',
      tier: ssm.ParameterTier.STANDARD,
      stringValue: "this came from Systems Manager Parameter Store",
    })
    // create a secret that will store a secret value
    const secretManagerEnvSecret = new secrets.Secret(this,'dockerSecret',{
      secretStringValue: cdk.SecretValue.unsafePlainText("this came from Secrets Manager. Because it's stored in a template, this should not be a real secret."),
      secretName: 'helloworldsecret'
    })

    // Create EFS volume for files. EFS volume will be available to admin EC2 nodes we created above, and to the container we create below. The container will only 
    // get read access.
    const efsFs = new efs.FileSystem(this,'helloWorldExternalFiles',{
      vpc: default_vpc,
      enableAutomaticBackups: true,
      encrypted: true,
      fileSystemName: 'helloWorldEFS'
    });
    

    // create a userdata setup that self-patches new instances before they are available for use
    // because we want an ec2 instance to build our docker image, deploy files to efs, etc... use the userData to make 
    // the host useful for that.
    const userData = ec2.UserData.forLinux();
    userData.addCommands('yum update -y');
    userData.addCommands('yum install -y docker amazon-efs-utils')
    userData.addCommands('systemctl docker.service enable')
    userData.addCommands('mkdir /efs')
    userData.addCommands('echo "' + efsFs.fileSystemId + ':/  /efs  efs _netdev,noresvport,tls 0 0" >> /etc/fstab')
    userData.addOnExitCommands('reboot')

    // create an autoscaling group for management interfaces? why an ASG? because we can, and even the management ec2 instance we'll use to
    // make a docker image should be treated as if it's not a pet.
    // use standard AmazonLinux 2
    const adminAsg = new autoscaling.AutoScalingGroup(this,'helloWorldAdminAsg',{
      autoScalingGroupName: "HelloWorldAdminAsg",
      vpc: default_vpc,
      vpcSubnets: default_vpc.selectSubnets( { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } ),
      instanceType: new ec2.InstanceType(props.ec2_instance_size),
      machineImage: ec2.MachineImage.fromSsmParameter(aws_ami_ssm_path),
      keyName: props.ssh_access_key_name,
      minCapacity: 0,
      maxCapacity: 1,
      newInstancesProtectedFromScaleIn: false,
      maxInstanceLifetime: cdk.Duration.days(7),
      requireImdsv2: true,
      terminationPolicies: [
        autoscaling.TerminationPolicy.OLDEST_INSTANCE,
        autoscaling.TerminationPolicy.CLOSEST_TO_NEXT_INSTANCE_HOUR,
        autoscaling.TerminationPolicy.DEFAULT,
      ],
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
    });
    for (let range of props.admin_access_nets) {
      adminAsg.connections.allowFrom(ec2.Peer.ipv4(range),ec2.Port.allTraffic(),'Allow access from Admin network')
    }

    adminAsg.addUserData(userData.render()) // make sure we patch on boot
    // make sure role created by Cdk can talk to SSM
    adminAsg.role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this,"SSMManagedInstance","arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"))
    // make sure role created by Cdk can update our docker registry
    docker_repository.grantPullPush(adminAsg.role) 
    efsFs.grant(adminAsg.role,'elasticfilesystem:ClientWrite')
    efsFs.connections.allowDefaultPortFrom(adminAsg)

  
    // NOTICE HOW WE DID NOT NEED TO CREATE POLICIES. This is what CDK does for us!

    // From here forward, create the infrastructure to run the container. 



    // create ECS cluster. Disable fargate because we don't want it for this demo example, but enable container insights to get better metrics
    // of the containerized workload.
    const ecsCluster = new ecs.Cluster(this,'helloWorldECS',{
      vpc: default_vpc,
      containerInsights: true,
      enableFargateCapacityProviders: false,
      clusterName: "HelloWorldCluster"
    });
    // create an autoscaling group to run ec2 instances attached to the container. Use the ECS-optimized AmazonLinux AMI
    // we are not using a launchTemplate here.
    const ecsAutoScalingGroup = new autoscaling.AutoScalingGroup(this,'helloWorldASG',{
      autoScalingGroupName: "HelloWorldECSAsg",
      vpc: default_vpc,
      vpcSubnets: default_vpc.selectSubnets( { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } ),
      instanceType: new ec2.InstanceType(props.ec2_instance_size),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 0,
      maxCapacity: 3,
      newInstancesProtectedFromScaleIn: false,
      maxInstanceLifetime: cdk.Duration.days(7),
      terminationPolicies: [
        autoscaling.TerminationPolicy.OLDEST_INSTANCE,
        autoscaling.TerminationPolicy.CLOSEST_TO_NEXT_INSTANCE_HOUR,
        autoscaling.TerminationPolicy.DEFAULT,
      ],
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
      requireImdsv2: true
    });

    // cdk will insert userdata to make sure these instances join the cluster automatically. However, we want to extend this so we know
    // new members are pre-patched before they join.
    // create a userdata setup that self-patches new instances before they are available for use
    const ecsMemberUserData = ec2.UserData.forLinux();
    ecsMemberUserData.addCommands('yum update -y');
    ecsMemberUserData.addOnExitCommands('reboot')
    ecsAutoScalingGroup.addUserData(ecsMemberUserData.render())

    

    // define a capacity provider that uses the ASG to allow ECS to create and destroy instances, assign it to our cluster.
    const ecsCapacityProvider = new ecs.AsgCapacityProvider(this,'helloWorldCap',{
      capacityProviderName: "HelloWorldECSCapacityProvider",
      autoScalingGroup: ecsAutoScalingGroup,
      machineImageType: ecs.MachineImageType.AMAZON_LINUX_2,
      enableManagedScaling: true,
      enableManagedTerminationProtection: false
    })
    ecsCluster.addAsgCapacityProvider(ecsCapacityProvider)
   
    // define a task to run our service. this doesn't run the service, it only defines it
    const helloWorldTaskDefn = new ecs.TaskDefinition(this,'helloWorldTaskDefn',{
      compatibility: ecs.Compatibility.EC2,
      memoryMiB: '512',
      cpu: '128',
      networkMode: ecs.NetworkMode.AWS_VPC, // AWS_VPC networking means the container gets to use security groups.
    });
    // add the container to the task, including any environment variables we want to push in to the docker runtime
    const container = helloWorldTaskDefn.addContainer('helloWorldContainer',{
      containerName: 'helloWorld',
      image: ecs.ContainerImage.fromEcrRepository(docker_repository,'latest'),
      environment: {
        'TEST_ENV_VAR': 'Hard-coded-string',
        //'TEST_SSM_VAR': 'foo',
        //'TEST_SECRET_VAR': 'bar',
      },
      secrets: {
        'TEST_SECRET_VAR': ecs.Secret.fromSecretsManager(secretManagerEnvSecret),
        'TEST_SSM_VAR': ecs.Secret.fromSsmParameter(ssmEnvParam),
      },
      essential: true,
      memoryLimitMiB: 512,
      // allowing the container to write to its own ephemeral filesystem will generate a finding, but apache expects to be able 
      // to write temporary and pid files.
      //readonlyRootFilesystem: true,
      logging: ecs.LogDrivers.awsLogs({ 
        logGroup: loggroup,
        streamPrefix: 'helloWorld',
        mode: ecs.AwsLogDriverMode.NON_BLOCKING}), // send container logs to cloudwatch
      portMappings: [ 
        { containerPort: 80 }
      ],
      stopTimeout: cdk.Duration.seconds(15),
      startTimeout: cdk.Duration.seconds(40),
      // command
      // healthCheck
    });
    // grant the container access to any props we create.
    // ssm_param.grantRead(helloWorldTaskDefn.taskRole)
    //ssmEnvParam.grantRead(helloWorldTaskDefn.taskRole)
    //secretManagerEnvSecret.grantRead(helloWorldTaskDefn.taskRole)

    helloWorldTaskDefn.addVolume({
      name: 'efs',
      efsVolumeConfiguration: {
        fileSystemId: efsFs.fileSystemId,
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
    const helloWorldService = new ecs.Ec2Service(this,'helloWorldService',{
      serviceName: "helloWorldService",
      cluster: ecsCluster,
      taskDefinition: helloWorldTaskDefn,
      desiredCount: 2,
      capacityProviderStrategies: [
        {
          capacityProvider: ecsCapacityProvider.capacityProviderName,
          weight: 1
        }
      ],
      enableECSManagedTags: true,
      placementStrategies: [ ecs.PlacementStrategy.spreadAcross('attribute:ecs.availability-zone'), ecs.PlacementStrategy.packedByMemory() ],
    });
    // make sure the service goes away when we kill the CfnStack
    helloWorldService.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY)

    // we need to explicity grant SG access from the Hello World Service to the EFS volume
    efsFs.connections.allowFrom(helloWorldService,ec2.Port.tcp(2049))

    // create a load balancer to present the application
    const helloWorldLB = new elb2.ApplicationLoadBalancer(this,'helloWorldLB',{
      loadBalancerName: "helloWorldAlb",
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
        service: helloWorldService,
        input: build_output,
      })
    );

    //Unable to access the artifact with Amazon S3 object key 'HelloWorldPipeline/HelloWorld/IBRxdN7'
    // located in the Amazon S3 artifact bucket 'helloworldcdkstack-helloworldpipelineartifactsbuc-cyhlli4csqn7'. 
    //The provided role does not have sufficient permissions.
    


    const httpListener = helloWorldLB.addListener('httpListener',{
      port: 80,
      protocol: elb2.ApplicationProtocol.HTTP,
      open: true,
    });
    const httpTargetGroup = httpListener.addTargets('helloWorldTarget',{
      port: 80,
      targets: [
        helloWorldService.loadBalancerTarget({
          containerName: 'helloWorld',
          containerPort: 80
        })
      ],
      healthCheck: {
        path: '/'
      }
    });
    
    // to test your service, you need to know where to go. output the lb name so it is visible
    const lbName = new cdk.CfnOutput(this,'lbName',{ value: helloWorldLB.loadBalancerDnsName, exportName: 'helloWorldLBName' });
    // TODO: send load balancer logs to S3!
    //       encrypt LogGroups
    //       redeploy when container updates
    //       codecommit to store container
    //       codepipeline to build
  }
}