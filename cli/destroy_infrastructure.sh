#!/bin/sh

set -ev

. ./set_vars.sh


aws ecs unassociated-capacity-provider
aws ecs delete-capacity-provider
aws ecs delete-cluster --cluster-name ${foo}

aws autoscaling delete-launch-configuration --launch-configuration-name ${ADMIN_LAUNCH_CONFIG}
aws autoscaling delete-launch-configuration --launch-configuration-name ${ECS_LAUNCH_CONFIG}

aws ecs revoke-security-group-ingress --group-name ${EC2_EFS_ACCESS_SG} --protocol tcp --port 2049 --source-group ${EC2_ADMIN_INSTANCE_SG}
aws ec2 delete-security-group --group-name ${EC2_ADMIN_INSTANCE_SG} --vpc-id=${VPC_ID}
aws ec2 delete-security-group --group-name ${EC2_ECS_INSTANCE_SG} --vpc-id=${VPC_ID}

aws iam remove-role-from-instance-profile --instance-profile-name ${ADMIN_INSTANCE_PROFILE} --role-name ${ADMIN_INSTANCE_ROLE}
aws iam remove-role-from-instance-profile --instance-profile-name ${ECS_INSTANCE_PROFILE} --role-name ${ECS_INSTANCE_ROLE}

aws iam delete-instance-profile --instance-profile-name ${ADMIN_INSTANCE_PROFILE}
aws iam delete-instance-profile --instance-profile-name ${ECS_INSTANCE_PROFILE}

aws iam delete-role --role-name  ${ADMIN_INSTANCE_ROLE}
aws iam delete-role --role-name ${ECS_INSTANCE_ROLE}