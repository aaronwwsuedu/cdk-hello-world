#!/bin/sh

set -ev

. ./set_vars.sh

# this script expects create_infrastructure.sh to have already run
# it builds on previous objects to create an ECS service that connects
# to our data elements and a load balancer to enable multi-AZ support


# Create Roles

##HelloWorldBuilderRole517FE345	HWCdkDataStackHWDCdkInfrS-HelloWorldBuilderRole517-1JY1E85SUWG5G	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_CB_BUILDER_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "codebuild.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'

##HelloWorldPipelineBuildHelloWorldDockerBuildImagesCodePipelineActionRoleAEACFB07	HWCdkDataStackHWDCdkInfrS-HelloWorldPipelineBuildH-94TQJ48JVRC	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_CP_BUILDACTION_ROLE} --assume-role-policy-document "{ \"Version\": \"2012-10-17\", \"Statement\": [ { \"Effect\": \"Allow\", \"Principal\": { \"AWS\": \"arn:aws:iam::${AWS_ACCOUNT_ID}:root\" }, \"Action\": \"sts:AssumeRole\" } ] }"

##HelloWorldPipelineDeployDeployActionCodePipelineActionRoleC27CEB8E	HWCdkDataStackHWDCdkInfrS-HelloWorldPipelineDeploy-Q3DF4O5KQ1Y3	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_CP_DEPLOYACTION_ROLE} --assume-role-policy-document "{ \"Version\": \"2012-10-17\", \"Statement\": [ { \"Effect\": \"Allow\", \"Principal\": { \"AWS\": \"arn:aws:iam::${AWS_ACCOUNT_ID}:root\" }, \"Action\": \"sts:AssumeRole\" } ] }"

##HelloWorldPipelineEventsRoleE6C71CB2	HWCdkDataStackHWDCdkInfrS-HelloWorldPipelineEvents-UQ28QCFSJ8MN	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_CP_EVENT_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "events.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'

##HelloWorldPipelineRole2A093307	HWCdkDataStackHWDCdkInfrS-HelloWorldPipelineRole2A-VDE3YA7OG97Q	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_CP_PIPELINE_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "codepipeline.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'

##HelloWorldTaskDefnTaskRoleEC611BC4	HWCdkDataStackHWDCdkInfrS-HelloWorldTaskDefnTaskRo-16IODDRWZ1XK	AWS::IAM::Role	CREATE_COMPLETE
aws iam create-role --role-name ${IAM_ECS_TASK_DEFINITION_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'

##HelloWorldPipelineSourceCodePipelineActionRoleB14709D5	HWCdkDataStackHWDCdkInfrS-HelloWorldPipelineSource-1TM3RT3VS8AJ2	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_CP_SOURCEACTION_ROLE} --assume-role-policy-document "{ \"Version\": \"2012-10-17\", \"Statement\": [ { \"Effect\": \"Allow\", \"Principal\": { \"AWS\": \"arn:aws:iam::${AWS_ACCOUNT_ID}:root\" }, \"Action\": \"sts:AssumeRole\" } ] }"

##HelloWorldTaskDefnExecutionRole3838A63A	HWCdkDataStackHWDCdkInfrS-HelloWorldTaskDefnExecut-AD6U793TAHZU	AWS::IAM::Role	CREATE_COMPLETE	-
aws iam create-role --role-name ${IAM_ECS_TASK_EXECUTION_ROLE} --assume-role-policy-document '{ "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Principal": { "Service": "ecs-tasks.amazonaws.com" }, "Action": "sts:AssumeRole" } ] }'

cat <<EOF ${TMPDIR}/pol_${IAM_CB_BUILDER_ROLE}
{
    "RoleName": "${IAM_CB_BUILDER_ROLE}",
    "PolicyName": "${IAM_CB_BUILDER_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": [
                    "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/codebuild/${CB_PROJECT_NAME}:*",
                    "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:/aws/codebuild/${CB_PROJECT_NAME}"
                ],
                "Effect": "Allow"
            },
            {
                "Action": [
                    "codebuild:BatchPutCodeCoverages",
                    "codebuild:BatchPutTestCases",
                    "codebuild:CreateReport",
                    "codebuild:CreateReportGroup",
                    "codebuild:UpdateReport"
                ],
                "Resource": "arn:aws:codebuild:${AWS_REGION}:${AWS_ACCOUNT_ID}:report-group/${CB_PROJECT_NAME}-*",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "s3:Abort*",
                    "s3:DeleteObject*",
                    "s3:GetBucket*",
                    "s3:GetObject*",
                    "s3:List*",
                    "s3:PutObject",
                    "s3:PutObjectLegalHold",
                    "s3:PutObjectRetention",
                    "s3:PutObjectTagging",
                    "s3:PutObjectVersionTagging"
                ],
                "Resource": [
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}",
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}/*"
                ],
                "Effect": "Allow"
            },
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
            }
        ]
    }
}
EOF
cat <<EOF ${TMPDIR}/pol_${IAM_CP_BUILDACTION_ROLE}
{
    "RoleName": "${IAM_CP_BUILDACTION_ROLE}",
    "PolicyName": "${IAM_CP_BUILDACTION_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "codebuild:BatchGetBuilds",
                    "codebuild:StartBuild",
                    "codebuild:StopBuild"
                ],
                "Resource": "arn:aws:codebuild:${AWS_REGION}:${AWS_ACCOUNT_ID}:project/${CB_PROJECT_NAME}",
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF ${TMPDIR}/pol_${IAM_CP_DEPLOYACTION_ROLE}
{
    "RoleName": "${IAM_CP_DEPLOYACTION_ROLE}",
    "PolicyName": "${IAM_CP_DEPLOYACTION_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "ecs:DescribeServices",
                    "ecs:DescribeTaskDefinition",
                    "ecs:DescribeTasks",
                    "ecs:ListTasks",
                    "ecs:RegisterTaskDefinition",
                    "ecs:UpdateService"
                ],
                "Resource": "*",
                "Effect": "Allow"
            },
            {
                "Condition": {
                    "StringEqualsIfExists": {
                        "iam:PassedToService": [
                            "ec2.amazonaws.com",
                            "ecs-tasks.amazonaws.com"
                        ]
                    }
                },
                "Action": "iam:PassRole",
                "Resource": "*",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "s3:GetBucket*",
                    "s3:GetObject*",
                    "s3:List*"
                ],
                "Resource": [
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}",
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}/*"
                ],
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF ${TMPDIR}/pol_${IAM_CP_EVENT_ROLE}
{
    "RoleName": "${IAM_CP_EVENT_ROLE}",
    "PolicyName": "${IAM_CP_EVENT_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": "codepipeline:StartPipelineExecution",
                "Resource": "arn:aws:codepipeline:${AWS_REGION}:${AWS_ACCOUNT_ID}:${CP_PIPELINENAME}",
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF ${TMPDIR}/pol_${IAM_CP_PIPELINE_ROLE}
{
    "RoleName": "${IAM_CP_PIPELINE_ROLE}",
    "PolicyName": "${IAM_CP_PIPELINE_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "s3:Abort*",
                    "s3:DeleteObject*",
                    "s3:GetBucket*",
                    "s3:GetObject*",
                    "s3:List*",
                    "s3:PutObject",
                    "s3:PutObjectLegalHold",
                    "s3:PutObjectRetention",
                    "s3:PutObjectTagging",
                    "s3:PutObjectVersionTagging"
                ],
                "Resource": [
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}",
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}/*"
                ],
                "Effect": "Allow"
            },
            {
                "Action": "sts:AssumeRole",
                "Resource": [
                    "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_BUILDACTION_ROLE}",
                    "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_DEPLOYACTION_ROLE}",
                    "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_SOURCEACTION_ROLE}"
                ],
                "Effect": "Allow"
            }
        ]
    }
}
EOF
# ECS_TASK_DEFINITION_ROLE has no policy.

cat <<EOF ${TMPDIR}/pol_${IAM_CP_SOURCEACTION_ROLE}
{
    "RoleName": "${IAM_CP_SOURCEACTION_ROLE}",
    "PolicyName": "${IAM_CP_SOURCEACTION_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "s3:Abort*",
                    "s3:DeleteObject*",
                    "s3:GetBucket*",
                    "s3:GetObject*",
                    "s3:List*",
                    "s3:PutObject",
                    "s3:PutObjectLegalHold",
                    "s3:PutObjectRetention",
                    "s3:PutObjectTagging",
                    "s3:PutObjectVersionTagging"
                ],
                "Resource": [
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}",
                    "arn:aws:s3:::${S3_CP_ARTIFACT_BUCKET}/*"
                ],
                "Effect": "Allow"
            },
            {
                "Action": [
                    "codecommit:CancelUploadArchive",
                    "codecommit:GetBranch",
                    "codecommit:GetCommit",
                    "codecommit:GetUploadArchiveStatus",
                    "codecommit:UploadArchive"
                ],
                "Resource": "arn:aws:codecommit:${AWS_REGION}:${AWS_ACCOUNT_ID}:${CODECOMMIT_REPO_NAME}",
                "Effect": "Allow"
            }
        ]
    }
}
EOF
cat <<EOF ${TMPDIR}/pol_${IAM_ECS_TASK_EXECUTION_ROLE}
{
    "RoleName": "${IAM_ECS_TASK_EXECUTION_ROLE}",
    "PolicyName": "${IAM_ECS_TASK_EXECUTION_ROLE}-policy",
    "PolicyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "ecr:BatchCheckLayerAvailability",
                    "ecr:BatchGetImage",
                    "ecr:GetDownloadUrlForLayer"
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
                "Action": [
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": "arn:aws:logs:${AWS_REGION}:${AWS_ACCOUNT_ID}:log-group:${LOGS_GROUP_NAME}:*",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "secretsmanager:DescribeSecret",
                    "secretsmanager:GetSecretValue"
                ],
                "Resource": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_SECRET_NAME}",
                "Effect": "Allow"
            },
            {
                "Action": [
                    "ssm:DescribeParameters",
                    "ssm:GetParameter",
                    "ssm:GetParameterHistory",
                    "ssm:GetParameters"
                ],
                "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${SSM_PARAMETER_NAME}",
                "Effect": "Allow"
            }
        ]
    }
}
EOF

aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_CB_BUILDER_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_CP_BUILDACTION_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_CP_DEPLOYACTION_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_CP_EVENT_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_CP_PIPELINE_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_CP_SOURCEACTION_ROLE}
aws iam put-role-policy --cli-input-json file://${TMPDIR}/pol_${IAM_ECS_TASK_EXECUTION_ROLE}

# Create Security Groups
aws ec2 create-security-group --group-name ${ALB_SG} --vpc-id=${VPC_ID} --description ${ALB_SG}
ALB_SG_ID=`aws ec2 describe-security-groups --filters Name=group-name,Values=${ALB_SG} --query 'SecurityGroups[].GroupId' --output text`
aws ec2 create-security-group --group-name ${ECS_SERVICE_SG} --vpc-id=${VPC_ID} --description ${ECS_SERVICE_SG}
ECS_SERVICE_SG_ID=`aws ec2 describe-security-groups --filters Name=group-name,Values=${ECS_SERVICE_SG} --query 'SecurityGroups[].GroupId' --output text`

# revoke default egress rule for ALB
aws ec2 revoke-security-group-egress --group-id ${ALB_SG_ID} --protocol all --cidr 0.0.0.0/0

# Create Security Group Rules to allow access to LB and allow LB access to service
aws ec2 authorize-security-group-ingress --group-id ${ALB_SG_ID} --protocol tcp --port 80 --cidr 0.0.0.0/0 
aws ec2 authorize-security-group-ingress --group-id ${ECS_SERVICE_SG_ID} --protocol tcp --port 80 --source-group ${ALB_SG_ID}
aws ec2 authorize-security-group-egress --group-id  ${ALB_SG_ID} --ip-permissions IpProtocol=tcp,FromPort=80,ToPort=80,UserIdGroupPairs="[{GroupId=${ECS_SERVICE_SG_ID}}]"

# Create Task Definition
cat <<EOF > ${TMPDIR}/ecsTaskDefinition.json
{
    "containerDefinitions": [
        {
            "name": "HelloWorld",
            "image": "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:latest",
            "cpu": 0,
            "memory": 512,
            "links": [],
            "portMappings": [
                {
                    "containerPort": 80,
                    "hostPort": 80,
                    "protocol": "tcp"
                }
            ],
            "essential": true,
            "environment": [
                {
                    "name": "TEST_ENV_VAR",
                    "value": "Hard-coded-string"
                }
            ],
            "mountPoints": [
                {
                    "sourceVolume": "efs",
                    "containerPath": "/usr/local/apache2/htdocs/efs",
                    "readOnly": true
                }
            ],
            "volumesFrom": [],
            "secrets": [
                {
                    "name": "TEST_SECRET_VAR",
                    "valueFrom": "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:${SECRET_SECRET_NAME}"
                },
                {
                    "name": "TEST_SSM_VAR",
                    "valueFrom": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/${SSM_PARAMETER_NAME}"
                }
            ],
            "startTimeout": 40,
            "stopTimeout": 15,
            "logConfiguration": {
                "logDriver": "awslogs",
                "options": {
                    "awslogs-group": "${LOGS_GROUP_NAME}",
                    "awslogs-region": "${AWS_REGION}",
                    "awslogs-stream-prefix": "HelloWorld",
                    "mode": "non-blocking"
                },
                "secretOptions": []
            },
            "systemControls": []
        }
    ],
    "taskRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_ECS_TASK_DEFINITION_ROLE}",
    "executionRoleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_ECS_TASK_EXECUTION_ROLE}",
    "networkMode": "awsvpc",
    "volumes": [
        {
            "name": "efs",
            "efsVolumeConfiguration": {
                "fileSystemId": "${EFS_ID}",
                "rootDirectory": "/",
                "transitEncryption": "ENABLED"
            }
        }
    ],
    "status": "ACTIVE",
    "requiresAttributes": [
        { "name": "ecs.capability.execution-role-awslogs" },
        { "name": "com.amazonaws.ecs.capability.ecr-auth" },
        { "name": "com.amazonaws.ecs.capability.docker-remote-api.1.17" },
        { "name": "com.amazonaws.ecs.capability.docker-remote-api.1.28" },
        { "name": "com.amazonaws.ecs.capability.task-iam-role" },
        { "name": "ecs.capability.execution-role-ecr-pull" },
        { "name": "ecs.capability.secrets.ssm.environment-variables" },
        { "name": "com.amazonaws.ecs.capability.docker-remote-api.1.18" },
        { "name": "ecs.capability.task-eni" },
        { "name": "com.amazonaws.ecs.capability.logging-driver.awslogs" },
        { "name": "ecs.capability.efsAuth" },
        { "name": "com.amazonaws.ecs.capability.docker-remote-api.1.19" },
        { "name": "ecs.capability.secrets.asm.environment-variables" },
        { "name": "ecs.capability.efs" },
        { "name": "ecs.capability.container-ordering" },
        { "name": "com.amazonaws.ecs.capability.docker-remote-api.1.25" }
    ],
    "compatibilities": [ "EC2" ],
    "requiresCompatibilities": [ "EC2" ],
    "cpu": "128",
    "memory": "512",
}
EOF
aws ecs register-task-defintion --family ${ECS_TASK_DEFN_NAME} --cli-input-json file://${TMPDIR}/ecsTaskDefinition.json

# Create ALB
##HelloWorldLB559BC142	arn:aws:elasticloadbalancing:${AWS_REGION}:${AWS_ACCOUNT_ID}:loadbalancer/app/HelloWorldAlb/c0bc9f1406bb81c1	AWS::ElasticLoadBalancingV2::LoadBalancer	CREATE_COMPLETE	-
##HelloWorldLBhttpListenerE88305E3	arn:aws:elasticloadbalancing:${AWS_REGION}:${AWS_ACCOUNT_ID}:listener/app/HelloWorldAlb/c0bc9f1406bb81c1/5f0235c3df06d249	AWS::ElasticLoadBalancingV2::Listener	CREATE_COMPLETE	-
##HelloWorldLBhttpListenerHelloWorldTargetGroup622A1BA1	arn:aws:elasticloadbalancing:${AWS_REGION}:${AWS_ACCOUNT_ID}:targetgroup/HWCdk-Hello-1F0MAXNSBGAYF/bc2a25d2a95efba0	AWS::ElasticLoadBalancingV2::TargetGroup	CREATE_COMPLETE	-
aws alb2 create-load-balancer
aws alb2 create-listener
aws alb2 create-target-group --name ${ALB_TARGET_GROUP_NAME}...

# Create Service
cat <<EOF > ${TMPDIR}/ecsService.json
{
    "loadBalancers": [
        {
            "targetGroupArn": "arn:aws:elasticloadbalancing:${AWS_REGION}:${AWS_ACCOUNT_ID}:targetgroup/XXXHWCdk-Hello-1F0MAXNSBGAYF/bc2a25d2a95efba0",
            "containerName": "HelloWorld",
            "containerPort": 80
        }   
    ],  
    "desiredCount": 2,
    "capacityProviderStrategy": [
        {
            "capacityProvider": "${ECS_CAPACITY_PROVIDER}",
            "weight": 1,
            "base": 0 
        }   
    ],  
    "taskDefinition": "arn:aws:ecs:${AWS_REGION}:${AWS_ACCOUNT_ID}:task-definition/${ECS_TASK_DEFN_NAME}",
    "deploymentConfiguration": {
        "deploymentCircuitBreaker": {
            "enable": false,
            "rollback": false
        },  
        "maximumPercent": 200,
        "minimumHealthyPercent": 50
    },  
    "roleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS",
    "placementStrategy": [
        { "type": "spread", "field": "attribute:ecs.availability-zone" },  
        { "type": "binpack", "field": "MEMORY" }   
    ],  
    "networkConfiguration": {
        "awsvpcConfiguration": {
            "subnets": [ ${VPC_SUBNET_IDS_CSV} ],
            "securityGroups": [ "${ECS_SERVICE_SG_ID}" ],  
            "assignPublicIp": "DISABLED"
        }   
    },  
    "healthCheckGracePeriodSeconds": 60,
    "schedulingStrategy": "REPLICA", 
    "deploymentController": {
        "type": "ECS"
    },  
    "enableECSManagedTags": true,
    "propagateTags": "NONE",
    "enableExecuteCommand": false
}
EOF
aws ecs create-service --cluster ${ECS_CLUSTER_NAME} --service-name ${ECS_SERVICE_NAME} --cli-input-json file://${TMPDIR}/ecsService.json

# Create CodeBuild Project
cat <<EOF >${TMPDIR}/HWcbProject.yaml
{
    "name": "${CB_PROJECT_NAME}",
    "description": "Codebuild project to automatically rebuild hello world container from source",
    "source": {
        "type": "CODEPIPELINE",
        "buildspec": ""{\n  \"version\": \"0.2\",\n  \"artifacts\": {\n    \"files\": [\n      \"imagedefinitions.json\"\n    ]\n  },\n  \"phases\": {\n    \"pre_build\": {\n      \"commands\": [\n        \"$(aws ecr get-login --region \$AWS_DEFAULT_REGION --no-include-email)\",\n        \"COMMIT_HASH=$(echo \$CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)\",\n        \"IMAGE_TAG=\${COMMIT_HASH:=latest}\"\n      ]\n    },\n    \"build\": {\n      \"commands\": [\n        \"docker build -t \$REPOSITORY_URI:latest .\",\n        \"docker tag \$REPOSITORY_URI:latest \$REPOSITORY_URI:\$IMAGE_TAG\"\n      ]\n    },\n    \"post_build\": {\n      \"commands\": [\n        \"docker push \$REPOSITORY_URI:latest\",\n        \"docker push \$REPOSITORY_URI:\$IMAGE_TAG\",\n        \"printf '[{\\\"name\\\":\\\"%s\\\",\\\"imageUri\\\":\\\"%s\\\"}]' \$ECS_CONTAINER_NAME \$REPOSITORY_URI:\$IMAGE_TAG > imagedefinitions.json\"\n      ]\n    }\n  }\n}"",
    },
    "sourceVersion": "",
    "artifacts": {
        "type": "CODEPIPELINE",
    },
    "cache": {
        "type": "NO_CACHE",
    },
    "environment": {
        "type": "ARM_CONTAINER",
        "image": "aws/codebuild/amazonlinux2-aarch64-standard:1.0",
        "computeType": "BUILD_GENERAL1_SMALL",
        "environmentVariables": [
            {
                "name": "REPOSITORY_URI",
                "value": "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${CODECOMMIT_REPO_NAME}",
                "type": "PLAINTEXT"
            },
            {
                "name": "ECS_CONTAINER_NAME",
                "value": "HelloWorld",
                "type": "PLAINTEXT"
            },
        ],
        "privilegedMode": true,
        "certificate": "",
        "imagePullCredentialsType": "CODEBUILD"
    },
    "serviceRole": "${IAM_CB_BUILDER_ROLE}",
    "timeoutInMinutes": 5,
    "queuedTimeoutInMinutes": 0,
    "encryptionKey": "alias/aws/s3",
    "tags": [
        {
            "key": "",
            "value": ""
        }
    ],
}
EOF

aws codebuild create-project --name ${CB_PROJECT_NAME} --cli-input-json file://${TMPDIR}/HWcbProject.json


# Create CodePipeline using CodeBuild
cat <<EOF >${TMPDIR}/HWpipeline.json
{
    "name": "${CP_PIPELINENAME}",
    "roleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_PIPELINE_ROLE}",
    "artifactStore": {
        "type": "S3",
        "location": "${S3_CP_ARTIFACT_BUCKET}"
    },
    "stages": [
        {
            "name": "Source",
            "actions": [
                {
                    "name": "Source",
                    "actionTypeId": {
                        "category": "Source",
                        "owner": "AWS",
                        "provider": "CodeCommit",
                        "version": "1"
                    },
                    "runOrder": 1,
                    "configuration": {
                        "BranchName": "main",
                        "PollForSourceChanges": "false",
                        "RepositoryName": "${CODECOMMIT_REPO_NAME}"
                    },
                    "outputArtifacts": [
                        {
                            "name": "HelloWorldSourceArtifact"
                        }
                    ],
                    "inputArtifacts": [],
                    "roleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_SOURCEACTION_ROLE}"
                }
            ]
        },
        {
            "name": "Build",
            "actions": [
                {
                    "name": "HelloWorldDockerBuildImages",
                    "actionTypeId": {
                        "category": "Build",
                        "owner": "AWS",
                        "provider": "CodeBuild",
                        "version": "1"
                    },
                    "runOrder": 1,
                    "configuration": {
                        "ProjectName": "HelloWorldPipelineBuild"
                    },
                    "outputArtifacts": [
                        {
                            "name": "HelloWorldBuildArtifact"
                        }
                    ],
                    "inputArtifacts": [
                        {
                            "name": "HelloWorldSourceArtifact"
                        }
                    ],
                    "roleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_BUILDACTION_ROLE}"
                }
            ]
        },
        {
            "name": "Deploy",
            "actions": [
                {
                    "name": "DeployAction",
                    "actionTypeId": {
                        "category": "Deploy",
                        "owner": "AWS",
                        "provider": "ECS",
                        "version": "1"
                    },
                    "runOrder": 1,
                    "configuration": {
                        "ClusterName": "${ECS_CLUSTER_NAME}",
                        "ServiceName": "${ECS_SERVICE_NAME}"
                    },
                    "outputArtifacts": [],
                    "inputArtifacts": [
                        {
                            "name": "HelloWorldBuildArtifact"
                        }
                    ],
                    "roleArn": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${IAM_CP_DEPLOYACTION_ROLE}"
                }
            ]
        }
    ],
    "version": 1
}
EOF
aws codepipeline create-pipeline --pipeline ${CP_PIPELINENAME} --cli-input-json file://${TMPDIR}/HWpipeline.json

# Create EventBridge rule/target to invoke codepipeline when repo is updated
aws events put-rule --name ${EVENT_CP_RULE} \
  --event-pattern "{\"detail-type\":[\"CodeCommit Repository State Change\"],\"resources\":[\"arn:aws:codecommit:us-west-2:${AWS_ACCOUNT_ID}:${helloWorldGitRepo}\"],\"source\":[\"aws.codecommit\"],\"detail\":{\"event\":[\"referenceCreated\",\"referenceUpdated\"],\"referenceName\":[\"main\"]}}" \
  --state ENABLED
aws events --rule ${EVENT_CP_RULE} \
  --targets "Id"="Target0","Arn"="arn:aws:codepipeline:${AWS_REGION}:${AWS_ACCOUNT_ID}:${CP_PIPELINENAME}","RoleArn"="arn:aws:iam:${AWS_ACCOUNT_ID}:role/${IAM_CP_EVENT_ROLE}"

# service should be available


