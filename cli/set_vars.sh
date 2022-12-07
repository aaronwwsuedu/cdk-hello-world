#!/bin/sh

set -ev

# variables that need to be tuned
export AWS_REGION=us-west-2
export EC2_ADMIN_SSH_KEY=aaronw-test-key
export EC2_ADMIN_INSTANCE_SIZE=t3.micro
export EC2_ECS_INSTANCE_SIZE=t3.small
export VPC_ID=vpc-0fab9087c94fc9c4c
export VPC_SUBNET_IDS="subnet-0b695cb63afbdf19d subnet-0c5caa837536a22c6"

# variables that are pulled from AWS
export AWS_ACCOUNT_ID=`aws sts get-caller-identity --output text | awk '{print $1}'`

# variables that can be changed, but should be fine as they sit.
export ECS_CLUSTER_NAME=helloWorldCluster

export AUTOSCALE_ADMIN_LAUNCH_CONFIG=ecsHelloWorldLaunchConfig

export IAM_ADMIN_INSTANCE_ROLE=helloWorldAdminEc2Role
export IAM_ADMIN_INSTANCE_PROFILE=helloWorldEc2AdminInstanceProfile
export IAM_ECS_INSTANCE_ROLE=helloWorldEcsEc2Role
export IAM_ECS_INSTANCE_PROFILE=helloWorldEc2ECSInstanceProfile

export SECRET_SECRET_NAME=helloWorldSecret

export SSM_PARAMETER_NAME=helloWorldSSMParameter

export CODECOMMIT_REPO_NAME=helloWorldGitRepo

export ECR_REPO_NAME=helloWorldDockerRepo

export LOGS_GROUP_NAME=helloWorldLogGroup

export EFS_FS_NAME=helloWorldEFS
