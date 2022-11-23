#!/bin/sh

# list names of objects we're going to delete
SECRETNAME=helloWorldSecret
PARAMETERNAME=helloWorldSSMParameter
ECRREPO=helloWorldDockerRepo
GITREPO=helloWorldGitRepo
EFSFS=helloWorldEFSFS
LOGS=helloWorldLogGroup


# codecommit, cloudwatch logs, systems manager parameters, and ECR can be deleted by name.
aws codecommit delete-repository --repository-name ${GITREPO}
aws ecr delete-repository --repository-name ${ECRREPO}
aws logs  delete-log-group ${LOGS}
aws ssm delete-parameter ${PARAMETERNAME}

# we can't delete a secret from the name. use the name to get the ID, then delete that.
SECRETARN=`aws secretsmanager list-secrets --filter Key=name,Values=${SECRETNAME} --output text | grep ${SECRETNAME} | awk '{print $2}'`
aws secretsmanager delete-secret --secret-id ${SECRETARN}

# we can't delete a filesystem by name. use the name to get an ID
EFS_ID=`aws efs describe-file-systems --query "FileSystems[?Name == \`${EFSFS}\`].FileSystemId" --output text`
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