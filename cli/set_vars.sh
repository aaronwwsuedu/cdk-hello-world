#!/bin/sh

#set -ev

# variables that need to be tuned
export AWS_REGION=us-west-2
export EC2_ADMIN_SSH_KEY=aaronw-test-key
export ROLE_BASED_NETWORK_SRC_CIDR=10.153.1.0/24
export S3_CP_ARTIFACT_BUCKET=helloworldpipelibebucket-2l478oe123io47345
export VPC_ID=vpc-0fab9087c94fc9c4c
export VPC_SUBNET_IDS="subnet-0b695cb63afbdf19d subnet-0c5caa837536a22c6"



export EC2_ADMIN_INSTANCE_SIZE=t4g.small
export EC2_ECS_INSTANCE_SIZE=t4g.micro
export EC2_ADMIN_AMI_PARAM=/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-arm64-gp2
export EC2_ECS_AMI_PARAM=/aws/service/ecs/optimized-ami/amazon-linux-2/arm64/recommended/image_id
export EC2_ADMIN_INSTANCE_SG=sg_ec2_helloworld_admin
export EC2_ECS_INSTANCE_SG=sg_ec2_helloworld_ecs
export EC2_EFS_ACCESS_SG=sg_efs_helloworld_access

# S3 buckets MUST BE UNIQUE. THIS WILL NEED TO BE RENAMED.
export VPC_SUBNET_IDS_CSV=`echo ${VPC_SUBNET_IDS} | tr ' ' ','`

# variables that are pulled from AWS
export AWS_ACCOUNT_ID=`aws sts get-caller-identity --output text | awk '{print $1}'`

# variables that can be changed, but should be fine as they sit.
export ECS_CLUSTER_NAME=helloWorldCluster
export ECS_TASK_DEFN_NAME=helloWorldTaskDefinition
export ECS_SERVICE_NAME=helloWorldService

export AUTOSCALE_ADMIN_LAUNCH_CONFIG=adminHelloWorldLaunchConfig
export AUTOSCALE_ECS_LAUNCH_CONFIG=ecsHelloWorldLaunchConfig

export IAM_ADMIN_INSTANCE_ROLE=helloWorldAdminEc2Role
export IAM_ADMIN_INSTANCE_PROFILE=helloWorldEc2AdminInstanceProfile
export IAM_ECS_INSTANCE_ROLE=helloWorldEcsEc2Role
export IAM_ECS_INSTANCE_PROFILE=helloWorldEc2ECSInstanceProfile
export IAM_ECS_TASK_DEFINITION_ROLE=helloWorldECSTaskDefnRole
export IAM_ECS_TASK_EXECUTION_ROLE=heloWorldECSTaskExecRole

export SECRET_SECRET_NAME=helloWorldSecret

export SSM_PARAMETER_NAME=helloWorldSSMParameter

export CODECOMMIT_REPO_NAME=helloWorldGitRepo

export ECR_REPO_NAME=hello_world_docker_repo

export LOGS_GROUP_NAME=helloWorldLogGroup

export EFS_FS_NAME=helloWorldEFS

export CP_PIPELINENAME=helloWorldDemoCodePipeline
export CB_PROJECT_NAME=helloWorldDemoBuildProject

export EVENT_CP_RULE=helloWorldDemoBuildEvent
