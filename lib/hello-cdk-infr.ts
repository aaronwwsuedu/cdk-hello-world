import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';

var path = require('path');

interface HelloWorldInfrStackProps extends cdk.StackProps {
  default_vpc_id: string;
  admin_access_nets: string[];
  ssh_access_key_name: string;
  admin_instance_type: string;
  ecs_instance_type: string;
  admin_instance_ami_param: string;

  efsFs: efs.IFileSystem;
  gitrepo: codecommit.IRepository;
  docker_repository: ecr.IRepository;
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
      instanceType: new ec2.InstanceType(props.admin_instance_type),
      machineImage: ec2.MachineImage.fromSsmParameter(props.admin_instance_ami_param),
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
      instanceType: new ec2.InstanceType(props.ecs_instance_type),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.ARM),
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