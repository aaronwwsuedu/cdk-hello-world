#!/bin/sh

#set -ev

# this script creates the baseline data elements:
#  a secret manager secret
#  a systems manager parameter
#  a codecommit repo
#  an ecr repo
#  an EFS filesystem
#  a Cloudwatch Log group

. ./set_vars.sh

aws secretsmanager create-secret --name ${SECRET_SECRET_NAME} --secret-string "myStartingSecret"

aws codecommit create-repository --repository-name ${CODECOMMIT_REPO_NAME}

aws ecr create-repository --repository-name ${ECR_REPO_NAME} --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=KMS
aws ecr put-lifecycle-policy --repository-name ${ECR_REPO_NAME} \
  --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"Restrict repo to 1 untagged image","selection":{"tagStatus":"untagged","countType":"imageCountMoreThan","countNumber":1},"action":{"type":"expire"}},{"rulePriority":2,"description":"Maintain no more than 5 tagged images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}'

aws logs create-log-group --log-group-name ${LOGS_GROUP_NAME}
aws logs put-retention-policy --retention-in-days 180 --log-group-name ${LOGS_GROUP_NAME} 

aws ssm put-parameter --name ${SSM_PARAMETER_NAME} --description "A parameter in SSM for our container" --value 'some value!' --type String

aws efs create-file-system --performance-mode generalPurpose --encrypted --backup --tags "Key=Name,Value=${EFS_FS_NAME}" 
aws efs describe-file-systems --query "FileSystems[?Name == \`${EFS_FS_NAME}\`].FileSystemId" --output text
EFS_ID=`aws efs describe-file-systems --query "FileSystems[?Name == \\\`${EFS_FS_NAME}\\\`].FileSystemId" --output text` 

# create a security group too.
aws ec2 create-security-group --description "Security group allowing access to EFS:${EFS_FS_NAME}" --group-name "${EC2_EFS_ACCESS_SG}" --vpc-id ${VPC_ID}
SGID_EFS=`aws ec2 describe-security-groups --filters Name=group-name,Values=${EC2_EFS_ACCESS_SG} --query "SecurityGroups[].GroupId" --output text`
# and now we can finally create the mount targets.
for i in ${VPC_SUBNET_IDS}; do
    aws efs create-mount-target --file-system-id ${EFS_ID} --security-groups ${SGID_EFS} --subnet-id ${i}
done


aws s3api create-bucket --bucket ${S3_CP_ARTIFACT_BUCKET} --region ${AWS_REGION} --acl private --create-bucket-configuration LocationConstraint=us-west-2
aws s3api put-bucket-encryption --bucket ${S3_CP_ARTIFACT_BUCKET} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm": "aws:kms"},"BucketKeyEnabled": false}]}'
aws s3api put-public-access-block --bucket ${S3_CP_ARTIFACT_BUCKET} --public-access-block-configuration '{"BlockPublicAcls": true,"IgnorePublicAcls": true,"BlockPublicPolicy": true,"RestrictPublicBuckets": true}'
aws s3api put-bucket-policy --bucket ${S3_CP_ARTIFACT_BUCKET} \
   --policy "{\"Statement\":[{\"Effect\":\"Deny\",\"Principal\": {\"AWS\":\"*\"},\"Action\": \"s3:*\",\"Resource\":[\"arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}\",\"arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"