import * as cdk from 'aws-cdk-lib';
import { Construct, ConstructOrder } from 'constructs';
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
import { CloudWatchLogGroup, CodePipeline } from 'aws-cdk-lib/aws-events-targets';
import { CodeBuildAction, CodeDeployEcsDeployAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { CfnProfilePermission } from 'aws-cdk-lib/aws-signer';

var path = require('path');

interface HelloWorldDataStackProps extends cdk.StackProps {
  default_vpc_id: string;
};
interface HelloWorldInfrStackProps extends cdk.StackProps {
  default_vpc_id: string;
  admin_access_nets: string[];
  ssh_access_key_name: string;
  ec2_instance_size: string;

  efsFs: efs.IFileSystem;
  gitrepo: codecommit.IRepository;
  docker_repository: ecr.IRepository;
};
interface HelloWorldAppStackProps extends cdk.StackProps {
  default_vpc_id: string;
  ec2_instance_size: string;

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
// Data stack contains data elements like Properties, EFS, S3, etc. These resources are typically not
// destroyed with the CloudFormation Stack.
//
export class HelloWorldDataStack extends cdk.Stack {
  public efsFs: efs.FileSystem;
  public docker_repository: ecr.Repository;
  public gitrepo: codecommit.Repository;
  public ssmEnvParam: ssm.StringParameter;
  public secretManagerEnvSecret: secrets.Secret;
  public loggroup: logs.LogGroup;

  public source_artifact: codepipeline.Artifact;
  public build_artifact: codepipeline.Artifact;


  constructor(scope: Construct, id: string, props: HelloWorldDataStackProps) {
    super(scope, id, props);

    // artifacts to store pipeline output.
    this.source_artifact = new codepipeline.Artifact('HelloWorldSourceArtifact');
    this.build_artifact = new codepipeline.Artifact('HelloWorldBuildArtifact');

    // WSU uses a peering account to define the VPC. use the default_vpc_id to define the VPC object
    const default_vpc = ec2.Vpc.fromLookup(this,'DefaultVpc',{ vpcId: props.default_vpc_id})

    // create the group too.
    this.loggroup = new logs.LogGroup(this,'HelloWorldLogGroup',{
      //encryptionKey: new kms.Key(this,'HelloWorldCWKey'),
      retention: logs.RetentionDays.SIX_MONTHS,
    });

    // create a docker repository to store our test docker container image. 
    this.docker_repository = new ecr.Repository(this,'HelloWorldECRepo',{
      encryption: ecr.RepositoryEncryption.AES_256,
      repositoryName: 'helloworldrepo',
      // image scan on push at the repository level is depreciated, accounts should instead set a scan policy at the registry
      // level to apply to all repositories, but if leaving this unset or false will generate a Security Hub Finding.
      imageScanOnPush: true, 
    });
    // add lifecycle rules to automatically remove old images. This improves our security posture by removing stale data, and reduces our
    // Amazon Inspector costs by reducing the number of images to scan.
    this.docker_repository.addLifecycleRule({
      description: "Maintain no more than 5 tagged images",
      maxImageCount: 5,
      tagStatus: ecr.TagStatus.ANY,
    }),
    this.docker_repository.addLifecycleRule({
      description: "Restrict repo to 1 untagged image",
      maxImageCount: 1,
      tagStatus: ecr.TagStatus.UNTAGGED
    })

    // create a git repo to store the Dockerfile for our hello world container
    this.gitrepo = new codecommit.Repository(this,'HelloWorld',{
      repositoryName: 'HelloWorld',
      description: "Hello World demo container source",
      code: codecommit.Code.fromDirectory(path.join(__dirname,'..','hello-world-container')),
      
    });

    // create a systems manager parameter to store a value
    this.ssmEnvParam = new ssm.StringParameter(this,'HelloWorldSsmParam',{
      description: "a parameter needed by hello world",
      parameterName: '/helloworld/development/test_ssm_param',
      tier: ssm.ParameterTier.STANDARD,
      stringValue: "this came from Systems Manager Parameter Store",
    })
    // create a secret that will store a secret value
    this.secretManagerEnvSecret = new secrets.Secret(this,'dockerSecret',{
      secretStringValue: cdk.SecretValue.unsafePlainText("this came from Secrets Manager. Because it's stored in a template, this should not be a real secret."),
      secretName: 'helloworldsecret'
    })

    // Create EFS volume for files. EFS volume will be available to admin EC2 nodes we created above, and to the container we create below. The container will only 
    // get read access.
    this.efsFs = new efs.FileSystem(this,'HelloWorldExternalFiles',{
      vpc: default_vpc,
      enableAutomaticBackups: true,
      encrypted: true,
      fileSystemName: 'HelloWorldEFS'
    });

  }
};

//
// Infrastructure stack contains resources needed to bring service online. This will contain the 
// ECS cluster, any administrative resources to set up the service, etc.
// 
export class HelloWorldInfrStack extends cdk.Stack {
  public ecsCluster: ecs.Cluster;
  public asgCapacityProvider: ecs.AsgCapacityProvider;

  constructor(scope: Construct, id: string, props: HelloWorldInfrStackProps) {
    super(scope, id, props);

    // WSU uses a peering account to define the VPC. use the default_vpc_id to define the VPC object
    const default_vpc = ec2.Vpc.fromLookup(this,'DefaultVpc',{ vpcId: props.default_vpc_id})

    // Record the path of the SSM parameter that contains the current Amazon Linux 2 AMI
    const aws_ami_ssm_path = '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2'

    // create a userdata setup that self-patches new instances before they are available for use
    // because we want an ec2 instance to build our docker image, deploy files to efs, etc... use the userData to make 
    // the host useful for that.
    const userData = ec2.UserData.forLinux();
    // update baseline OS and install additional tools
    userData.addCommands('yum update -y');
    userData.addCommands('yum install -y docker amazon-efs-utils git')
    // enable docker. No need to start docker becauase we'll be rebooting
    userData.addCommands('systemctl enable docker.service')
    // add access to EFS filesystem
    userData.addCommands('mkdir /efs')
    userData.addCommands('echo "' + props.efsFs.fileSystemId + ':/  /efs  efs _netdev,noresvport,tls 0 0" >> /etc/fstab')
    // configure git to take advantage of our EC2 intance role
    userData.addCommands("git config --global credential.helper '!aws codecommit credential-helper $@'")
    userData.addCommands('git config --global credential.UseHttpPath true')
    // add command to reboot when config is done.
    userData.addOnExitCommands('reboot')

    // create an autoscaling group for management interfaces? why an ASG? because we can, and even the management ec2 instance we'll use to
    // make a docker image should be treated as if it's not a pet.
    // use standard AmazonLinux 2
    const adminAsg = new autoscaling.AutoScalingGroup(this,'HelloWorldAdminAsg',{
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

    adminAsg.addUserData(userData.render()) // make sure we set up our admin server on first boot
    // make sure role created by Cdk can talk to Systems Manager
    adminAsg.role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this,"SSMManagedInstance","arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"))
   
    // make sure role created by Cdk has IAM policy elements to write to our data resources.
    props.docker_repository.grantPullPush(adminAsg.role) 
    props.efsFs.grant(adminAsg.role,'elasticfilesystem:ClientWrite')
    props.gitrepo.grantPullPush(adminAsg.role)

    // Allow admin instances to connect to the EFS
    adminAsg.connections.allowToDefaultPort(props.efsFs)

    // create ECS cluster. Disable fargate because we don't want it for this demo example, but enable container insights to get better metrics
    // of the containerized workload.
    this.ecsCluster = new ecs.Cluster(this,'HelloWorldECS',{
      vpc: default_vpc,
      containerInsights: true,
      enableFargateCapacityProviders: false,
      clusterName: "HelloWorldCluster"
    });
    // create an autoscaling group to run ec2 instances attached to the container. Use the ECS-optimized AmazonLinux AMI
    // we are not using a launchTemplate here.
    const ecsAutoScalingGroup = new autoscaling.AutoScalingGroup(this,'HelloWorldASG',{
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
    this.asgCapacityProvider = new ecs.AsgCapacityProvider(this,'HelloWorldCap',{
      capacityProviderName: "HelloWorldECSCapacityProvider",
      autoScalingGroup: ecsAutoScalingGroup,
      machineImageType: ecs.MachineImageType.AMAZON_LINUX_2,
      enableManagedScaling: true,
      enableManagedTerminationProtection: false
    })
    this.ecsCluster.addAsgCapacityProvider(this.asgCapacityProvider)
  }
}

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

    // and finally, enable access to data resources via IAM policy
    //props.efsFs.grant(HelloWorldTaskDefn.taskRole,'elasticfilesystem:ClientRead')
    //props.ssmEnvParam.grantRead(HelloWorldTaskDefn.taskRole)
    //props.secretManagerEnvSecret.grantRead(HelloWorldTaskDefn.taskRole)

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

    //Unable to access the artifact with Amazon S3 object key 'HelloWorldPipeline/HelloWorld/IBRxdN7'
    // located in the Amazon S3 artifact bucket 'helloworldcdkstack-helloworldpipelineartifactsbuc-cyhlli4csqn7'. 
    //The provided role does not have sufficient permissions.
    


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
