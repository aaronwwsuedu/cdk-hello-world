#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { HelloWorldDataStack,HelloWorldAdminStack,HelloWorldAppStack } from '../lib/hello-cdk-stack';

const app = new cdk.App();

/* create a dictionary of tags to apply to everything we create */
const app_tags = {
  'service-id':      'hello-world',
  'service-family':  'development',
  'environment':     'development',
  'management-mode': 'automatic'
};

const default_vpc_id = 'vpc-0fab9087c94fc9c4c';
const admin_access_nets = [ '10.153.1.0/24' ];
const ssh_access_key_name = 'aaronw-test-server';
const ec2_instance_size = 't3.small';

const dataStack = new HelloWorldDataStack(app,'HWCdkDataStack',{
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* apply these tags to every object created in the stack. */
  tags: app_tags,

  default_vpc_id: default_vpc_id,
});
const adminStack = new HelloWorldAdminStack(dataStack,'HWDCdkAdminStack',{
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  /* apply these tags to every object created in the stack. */
  tags: app_tags,

  default_vpc_id: default_vpc_id,
  admin_access_nets: admin_access_nets,
  ssh_access_key_name: ssh_access_key_name,
  ec2_instance_size: ec2_instance_size,
  docker_repository: dataStack.docker_repository,
  gitrepo: dataStack.gitrepo,
  efsFs: dataStack.efsFs,
});
const appStack = new HelloWorldAppStack(dataStack,'HWCdkAppStack',{
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */

  /* apply these tags to every object created in the stack. */
  tags: app_tags,

  default_vpc_id: default_vpc_id,
  ec2_instance_size: ec2_instance_size,
  docker_repository: dataStack.docker_repository,
  gitrepo: dataStack.gitrepo,
  efsFs: dataStack.efsFs,
  loggroup: dataStack.loggroup,
  ssmEnvParam: dataStack.ssmEnvParam,
  secretManagerEnvSecret: dataStack.secretManagerEnvSecret,
});

/* requirements 
For the example application in this guide, the application needs at a conceptual level are:
resources to run a containerized application
high-availability, so if any single resource fails, the service continues to run
container image needs to be stored somewhere
data must be encrypted at rest
for the purposes of this example, data shall not be encrypted in transit. A real application would also need to use encrypted protocols, such as HTTPS
logs must be captured and stored for 2 months and then removed
parameters passed to container must be stored somewhere
files stored outside the container must be stored somewhere
the service must be self-maintaining: if the container is updated, the service rolls out the update automatically. Patches to the infrastructure must be applied automatically.
the service must be implemented using zero-trust: it can access the cloud resources it needs to run, but no other resources. If the service is compromised, zero-trust protects other resources in the cloud.

This example uses AWS technologies to fulfill the requirements:
Use EC2 instances to provide compute resources
Use Amazon ECS to create a cluster to run containers
Use the ECS service model to ensure that at least 2 tasks are running at any given time. 
Use an Amazon Load Balancer to distribute workloads over multiple Availability Zones.
Use KMS or service-specific encryption options to ensure storage is encrypted
Configure the log group retention policy to remove logs after 60 days.
Use systems manager to store public parameters
Use Secrets Manager to store secrets.
Use EFS to store files, mount EFS volume directly to container
Leverage Systems Manager to ensure long-term EC2 hosts are automatically patched
Leverage AutoScaler aging policies to ensure short-term EC2 hosts are automatically rotated
Use Cloud-init rules to ensure an EC2 instance applies any available patches before joining a cluster
Use deployment policies to ensure updates to the ECR repository are automatically deployed to a cluster
Use IAM Roles and Policies to ensure each component of the cluster can access the resources they need
Avoid AWS-Managed IAM Policies where possible, AWS-Managed policies are designed for broad access and are not strictly zero-trust

Unfullfilled/Unverified:

logs must be captured and stored for 2 months and then removed
*/