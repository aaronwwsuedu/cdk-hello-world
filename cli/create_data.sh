#!/bin/sh

set -ev

# this script creates the baseline data elements:
#  a secret manager secret
#  a systems manager parameter
#  a codecommit repo
#  an ecr repo
#  an EFS filesystem
#  a Cloudwatch Log group

SECRETNAME=helloWorldSecret
PARAMETERNAME=helloWorldSSMParameter
ECRREPO=helloWorldDockerRepo
GITREPO=helloWorldGitRepo
EFSFS=helloWorldEFSFS
LOGS=helloWorldLogGroup

VPC_ID=vpc-0fab9087c94fc9c4c # replace with your VPC!
SUBNET_IDS="subnet-0b695cb63afbdf19d subnet-0c5caa837536a22c6" # replace with your private subnets!

aws secretsmanager create-secret --name ${SECRETNAME} --secret-string "myStartingSecret"

aws codecommit create-repository --name ${GITREPO}

aws ecr create-repository --repository-name ${ECRREPO} --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=KMS
aws ecr put-lifecycle-policy --repository-name ${ECRREPO} \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"Restrict repo to 1 untagged image","selection":{"tagStatus":"untagged","countType":"imageCountMoreThan","countNumber":1},"action":{"type":"expire"}},{"rulePriority":2,"description":"Maintain no more than 5 tagged images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}'

aws logs create-log-group --log-group-name ${LOGS} -tags "${TAG_AS_DICT}" 
aws logs put-retention-policy --retention-in-days 180 --log-group-name ${LOGS} 

aws ssm put-parameter --name ${PARAMTERNAME} --description "A parameter in SSM for our container" --value "some value!"

aws efs create-file-system --performance-mode generalPurpose --encrypted --backup --tags "Key=Name,Value=${EFSFS}" 
aws efs describe-file-systems --query "FileSystems[?Name == \`${EFSFS}\`].FileSystemId" --output text
EFS_ID=`aws efs describe-file-systems --query "FileSystems[?Name == \`${EFSFS}\`].FileSystemId" --output text`
# create a security group too.
aws ec2 create-security-group --description "Security group allowing access to EFS:${EFSFS}" --group-name "sg_${EFSFS}" --vpc-id ${VPC_ID}
SGID_EFS=`aws ec2 describe-security-groups --filters Name=group-name,Values=sg_${EFSFS} --query "SecurityGroups[].GroupId" --output text`
# and now we can finally create the mount targets.
for i in ${SUBNET_IDS}; do
    aws efs create-mount-target --file-system-id ${EFS_FS_ID} --security-groups ${SGID_EFS} --subnet-id ${i}
done


# we can't delete a filesystem by name. use the name to get an ID
TARGET_IDS=`aws efs describe-mount-targets --file-system-id ${EFS_ID} --query 'MountTargets[].MountTargetId' --output text`
SECURITY_GROUPS=`for i in ${TARGET_IDS}; do aws efs describe-mount-target-security-groups --mount-target-id=$i --output text; done | uniq | awk '{print $2}'`

# now that we have the IDs, we can remove them.
for i in ${TARGET_IDS}; do
  aws efs delete-mount-target --mount-target-id ${i}
done
aws efs delete-file-system --file-system-id ${EFS_ID}
for i in ${SECURITY_GROUPS}; do
  aws ec2 delete-security-group --group-id ${i}
done