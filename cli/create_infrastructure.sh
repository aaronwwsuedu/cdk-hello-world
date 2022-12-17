#!/bin/sh

set -ev

. ./set_vars.sh


# this script expects the resources created by create_data.sh to be in place.
#
# it will create
#  An ecs cluster
#  An EC2 autoscaling group to support tasks on the cluster
#  An EC2 autoscaling group to support administrative tasks
#  A Capacity Provider using the autoscaling group
#  Security groups required for the instances created by the autoscaling groups
#  Roles required by the instances and cluster
#  
ADMIN_AMI=`aws ssm get-parameter --name ${EC2_ADMIN_AMI_PARAM} --query "Parameter.Value"`
ECS_AMI=`aws ssm get-parameter --name ${EC2_ECS_AMI_PARAM} --query "Parameter.Value"`

# make a temporary directory to store files on disk
TMPDIR=`mktemp -d data.XXXXXX`


# write out data needed to create launch configuration.
#  user data for EC2 instances
#  launch configuration data
cat <<EOF > ${TMPDIR}/admin_user_data.txt
#\!/bin/bash
function exitTrap(){
exitCode=\$?
reboot
}
trap exitTrap EXIT
yum update -y
yum install -y docker amazon-efs-utils git
systemctl enable docker.service
mkdir /efs
echo "${EFS_ID}:/  /efs  efs _netdev,noresvport,tls 0 0" >> /etc/fstab
EOF

cat <<EOF > ${TMPDIR}/ecs_user_data.txt
#\!/bin/bash
function exitTrap(){
exitCode=\$?
reboot
}
trap exitTrap EXIT
yum update -y
echo ECS_CLUSTER=${ECS_CLUSTER_NAME} >> /etc/ecs/ecs.config
sudo iptables --insert FORWARD 1 --in-interface docker+ --destination 169.254.169.254/32 --jump DROP
sudo service iptables save
echo ECS_AWSVPC_BLOCK_IMDS=true >> /etc/ecs/ecs.config
EOF

ADMIN_USER_DATA=`base64 -i ${TMPDIR}/admin_user_data.txt`
ECS_USER_DATA=`base64 -i ${TMPDIR}/ecs_user_data.txt`

# Create Security Group(s)
aws ec2 create-security-group --group-name ${EC2_ADMIN_INSTANCE_SG} --vpc-id=${VPC_ID} --description "Admin EC2 instances to manage app data"
aws ec2 create-security-group --group-name ${EC2_ECS_INSTANCE_SG} --vpc-id=${VPC_ID} --description "SG for ECS cluster members"

# get IDs for SG just created
EC2_ADMIN_INSTANCE_SG_ID=`aws ec2 describe-security-groups --filters Name=group-name,Values=${EC2_ADMIN_INSTANCE_SG} --query 'SecurityGroups[].GroupId' --output text`
EC2_ECS_INSTANCE_SG_ID=`aws ec2 describe-security-groups --filters Name=group-name,Values=${EC2_ECS_INSTANCE_SG} --query 'SecurityGroups[].GroupId' --output text`


# Create Security Group Rules for infrastructure access
aws ec2 authorize-security-group-ingress --group-name ${EC2_ADMIN_INSTANCE_SG} --protocol all --cidr ${ROLE_BASED_NETWORK_SRC_CIDR}
aws ec2 authorize-security-group-ingress --group-name ${EC2_EFS_ACCESS_SG} --protocol tcp --port 2049 --source-group ${EC2_ADMIN_INSTANCE_SG}


# Create Roles
# ec2 instance roles
aws iam create-role --role-name ${IAM_ADMIN_INSTANCE_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'
aws iam create-role --role-name ${IAM_ECS_INSTANCE_PROFILE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "ec2.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'
# ECS ASG drain/lifecycle roles
aws iam create-role --role-name ${IAM_ASG_DRAINHOOK_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'
aws iam create-role --role-name ${IAM_ECS_LIFECYCLE_HOOK_WRITE_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "autoscaling.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'

# Create Instance Profiles
aws iam create-instance-profile --instance-profile-name ${IAM_ADMIN_INSTANCE_PROFILE}
aws iam create-instance-profile --instance-profile-name ${IAM_ECS_INSTANCE_PROFILE}

aws iam add-role-to-instance-profile --instance-profile-name ${IAM_ADMIN_INSTANCE_PROFILE} --role-name ${IAM_ADMIN_INSTANCE_ROLE}
aws iam add-role-to-instance-profile --instance-profile-name ${IAM_ECS_INSTANCE_PROFILE} --role-name ${IAM_ECS_INSTANCE_ROLE}

# get the ARN for the instance profiles so we can insert them into the launch configuration template.
IAM_INSTANCE_ADMIN_PROFILE_ARN=`aws iam list-instance-profiles --query "InstanceProfiles[?InstanceProfileName==\`${IAM_ADMIN_INSTANCE_PROFILE}\`].Arn" --output text`
IAM_INSTANCE_ECS_PROFILE_ARN=`aws iam list-instance-profiles --query "InstanceProfiles[?InstanceProfileName==\`${IAM_ECS_INSTANCE_PROFILE}\`].Arn" --output text`

# Create Launch Configurations
cat  <<EOF > ${TMPDIR}/adminLaunchConfig.json
{
    "LaunchConfigurationName": "${AUTOSCALE_ADMIN_LAUNCH_CONFIG}",
    "ImageId": "${ADMIN_AMI}",
    "KeyName": "${ADMIN_SSH_KEY}",
    "SecurityGroups": [
        "${ADMIN_EC2_SG}"
    ],
    "ClassicLinkVPCSecurityGroups": [],
    "UserData": "${ADMIN_USER_DATA}",
    "InstanceType": "${EC2_ADMIN_INSTANCE_SIZE}",
    "KernelId": "",
    "RamdiskId": "",
    "BlockDeviceMappings": [],
    "InstanceMonitoring": {
        "Enabled": true
    },
    "SpotPrice": "",
    "IamInstanceProfile": "${IAM_INSTANCE_ADMIN_PROFILE_ARN}",
    "EbsOptimized": false,
    "AssociatePublicIpAddress": true,
    "PlacementTenancy": "",
    "MetadataOptions": {
        "HttpTokens": "required",
        "HttpPutResponseHopLimit": 1,
        "HttpEndpoint": "enabled"
    }
}
EOF

cat <<EOF > ${TMPDIR}/ecsLaunchConfig.json
{
    "LaunchConfigurationName": "${AUTOSCALE_ECS_LAUNCH_CONFIG}",
    "ImageId": "${ECS_AMI}",
    "KeyName": "",
    "SecurityGroups": [
        "${ECS_EC2_SG}"
    ],
    "ClassicLinkVPCSecurityGroups": [],
    "UserData": "${ECS_USER_DATA}",
    "InstanceType": "${EC2_ECS_INSTANCE_SIZE}",
    "KernelId": "",
    "RamdiskId": "",
    "BlockDeviceMappings": [],
    "InstanceMonitoring": {
        "Enabled": true
    },
    "IamInstanceProfile": "${IAM_INSTANCE_ECS_PROFILE_ARN}",
    "EbsOptimized": false,
    "MetadataOptions": {
        "HttpTokens": "required",
        "HttpPutResponseHopLimit": 1,
        "HttpEndpoint": "enabled"
    }
}
EOF
aws autoscaling create-launch-configuration --launch-configuration-name ${AUTOSCALE_ADMIN_LAUNCH_CONFIG} ---cli-input-json file://${TMPDIR}/adminLaunchConfig.json
aws autoscaling create-launch-configuration --launch-configuration-name ${AUTOSCALE_ECS_LAUNCH_CONFIG} ---cli-input-json file://${TMPDIR}/ecsLaunchConfig.json

# Create SNS Topic for Lifecycle Hook
aws sns create-topic --name "${SNS_ASG_LIFECYCLE_TOPIC}"
# get ARN for topic
SNS_ASG_LIFECYCLE_TOPIC_ARN=`aws sns list-topics --output text| grep ${SNS_ASG_LIFECYCLE_TOPIC} | awk '{print $2}'`

# Create AutoScalingGroups
aws autoscaling create-auto-scaling-group --auto-scaling-group-name ${AUTOSCALE_ADMIN_GROUP} --launch-configuration-name ${AUTOSCALE_ADMIN_LAUNCH_CONFIG} \
  --min-size 0 --max-size 1 --desired-capacity 0 \
  --vpc-zone-identifier `echo ${VPC_SUBNET_IDS} | tr ' ' ','` \
  --max-instance-lifetime 604800
aws autoscaling create-auto-scaling-group --auto-scaling-group-name ${AUTOSCALE_ECS_GROUP} --launch-configuration-name ${AUTOSCALE_ECS_LAUNCH_CONFIG} \
  --min-size 0 --max-size 3 --desired-capacity 0 \
  --vpc-zone-identifier `echo ${VPC_SUBNET_IDS} | tr ' ' ','` \
  --termination-policies "OldestInstance,ClosestToNextInstanceHour,Default" \
  --max-instance-lifetime 604800 \
  --lifecycle-hook-specification-list "[ { \"LifecycleHookName\": \"helloWorldASGLifecycleHook\", \"LifecycleTransition\": \"autoscaling:EC2_INSTANCE_TERMINATING\", \"NotificationTargetARN\": \"${SNS_ASG_LIFECYCLE_TOPIC_ARN}\", \"RoleARN\": \"arn:aws:iam::${AWS_ACCOUJNT_ID}:role/${IAM_ECS_LIFECYCLE_HOOK_WRITE_ROLE}\", \"HeartbeatTimeout\": 300, \"GlobalTimeout\": 30000, \"DefaultResult\": \"CONTINUE\" } ]"
AWS_ECS_ASG_ARN=`aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${AUTOSCALE_ECS_GROUP} --query "AutoScalingGroups[].AutoScalingGroupARN" --output text`

# Create Capacity Provider
aws ecs create-capacity-provider --name ${ECS_CAPACITY_PROVIDER} \
  --auto-scaling-group-provider autoScalingGroupArn=${AWS_ECS_ASG_ARN},managedScaling={status="ENABLED",targetCapacity=100,minimumScalingStepSize=1,maximumScalingStepSize=10000,instanceWarmupPeriod=300},managedTerminationProtection="DISABLED"

# Create Cluster
aws ecs create-cluster --cluster-name ${ECS_CLUSTER_NAME} \
  --capacity-providers ${ECS_CAPACITY_PROVIDER} \
  --settings containerInsights=enabled 

# Create ASG Drain Hooks for ECS
# aws autoscaling create-lifecycle-hook...
#aws lambda create-function HelloWorldASGDrainECSHookFunction135D003B...
#aws lambda set-permission HelloWorldASGDrainECSHookFunctionAllowInvokeHWCdkDataStackHWDCdkInfrStackHelloWorldASGLifecycleHookDrainHookTopic9F32314D76E0FFC2

# Create Role Policies
cat <<EOF > ${TMPDIR}/pol_${IAM_ASG_DRAINHOOK_ROLE}
{
    "RoleName": "${IAM_ASG_DRAINHOOK_ROLE}",
    "PolicyName": "${IAM_ASG_DRAINHOOK_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "ec2:DescribeHosts",
                    "ec2:DescribeInstanceAttribute",
                    "ec2:DescribeInstanceStatus",
                    "ec2:DescribeInstances"
                ],
                "Resource": "*",
                "Effect": "Allow"
            },
            {
                "Action": "autoscaling:CompleteLifecycleAction",
                "Resource": "arn:aws:autoscaling:${AWS_REGION}:${AWS_ACCOUNT_ID}:autoScalingGroup:*:autoScalingGroupName/${AUTOSCALE_ECS_LAUNCH_CONFIG}",
                "Effect": "Allow"
            },
            {
                "Condition": {
                    "ArnEquals": {
                        "ecs:cluster": "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${ECS_CLUSTER_NAME}"
                    }
                },
                "Action": [
                    "ecs:DescribeContainerInstances",
                    "ecs:DescribeTasks",
                    "ecs:ListTasks",
                    "ecs:UpdateContainerInstancesState"
                ],
                "Resource": "*",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "ecs:ListContainerInstances",
                    "ecs:SubmitContainerStateChange",
                    "ecs:SubmitTaskStateChange"
                ],
                "Resource": "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${ECS_CLUSTER_NAME}",
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF > ${TMPDIR}/pol_${IAM_ADMIN_INSTANCE_ROLE}
{
    "RoleName": "${IAM_ADMIN_INSTANCE_ROLE}",
    "PolicyName": "${IAM_ADMIN_INSTANCE_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "ecs:DeregisterContainerInstance",
                    "ecs:RegisterContainerInstance",
                    "ecs:Submit*"
                ],
                "Resource": "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${ECS_CLUSTER_NAME}",
                "Effect": "Allow"
            },
            {
                "Condition": {
                    "ArnEquals": {
                        "ecs:cluster": "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:cluster/${ECS_CLUSTER_NAME}"
                    }
                },
                "Action": [
                    "ecs:Poll",
                    "ecs:StartTelemetrySession"
                ],
                "Resource": "*",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "ecr:GetAuthorizationToken",
                    "ecs:DiscoverPollEndpoint",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": "*",
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF > ${TMPDIR}/pol_${IAM_ECS_LIFECYCLE_HOOK_WRITE_ROLE}
{
    "RoleName": "${IAM_ECS_LIFECYCLE_HOOK_WRITE_ROLE}",
    "PolicyName": "${IAM_ECS_LIFECYCLE_HOOK_WRITE_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": "sns:Publish",
                "Resource": "arn:aws:sns:${AWS_REGION}:${AWS_ACCOUNT_ID}:XXXHWCdkDataStackHWDCdkInfrStackFEA392BE-HelloWorldASGLifecycleHookDrainHookTopicAF655FED-AM5IJXkiCIJs",
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF > ${TMPDIR}/pol_${IAM_ECS_INSTANCE_PROFILE}
{
    "RoleName": "${IAM_ECS_INSTANCE_PROFILE}",
    "PolicyName": "${IAM_ECS_INSTANCE_PROFILE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:BatchGetImage",
                    "ecr:CompleteLayerUpload",
                    "ecr:GetDownloadUrlForLayer",
                    "ecr:InitiateLayerUpload",
                    "ecr:PutImage",
                    "ecr:UploadLayerPart"
                ],
                "Resource": "arn:aws:ecr:${AWS_REGION}:${AWS_ACCOUNT_ID}:repository/${ECR_REPO_NAME}",
                "Effect": "Allow"
            },
            {
                "Action": "ecr:GetAuthorizationToken",
                "Resource": "*",
                "Effect": "Allow"
            },
            {
                "Action": "elasticfilesystem:ClientWrite",
                "Resource": "arn:aws:elasticfilesystem:${AWS_REGION}:${AWS_ACCOUNT_ID}:file-system/${EFS_ID}",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "codecommit:GitPull",
                    "codecommit:GitPush"
                ],
                "Resource": "arn:aws:codecommit:${AWS_REGION}:${AWS_ACCOUNT_ID}:${CODECOMMIT_REPO_NAME}",
                "Effect": "Allow"
            }
        ]
    }
}
EOF

aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_ASG_DRAINHOOK_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_ADMIN_INSTANCE_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_ECS_LIFECYCLE_HOOK_WRITE_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_ECS_INSTANCE_PROFILE}

# at this point, we have a cluster that is capable of automatically growing to support tasks that run on it.
