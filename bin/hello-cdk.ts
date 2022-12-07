#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { HelloWorldDataStack } from '../lib/hello-cdk-data';
import { HelloWorldInfrStack } from '../lib/hello-cdk-infr';
import { HelloWorldAppStack } from '../lib/hello-cdk-service';

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

// use graviton instances, they're cheaper and provide the same performance
const ec2_admin_instance = 't4g.small';
const ec2_ecs_instance = 't4g.micro'
const ec2_ami_parameter = '/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-arm64-gp2'
// for x86
//const ec2_ami_parameter = /aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2

// data stack defines data resources. these are not typically deleted when the stack is destroyed and
// should be removed manually.
const dataStack = new HelloWorldDataStack(app,'HWCdkDataStack',{
  // env tells CDK where to set up the CloudFormation Stacks. We'll use the default account and region
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  // apply these tags to every object created in the stack. 
  tags: app_tags,

  // any additional variables here are because we require them in the definition for the stack.
  // see lib/hello-cdk-stack.ts
  default_vpc_id: default_vpc_id,
});

// infrasture stack builds on data stack, and creates resources to manipulate the data elements and 
// also sets up the ECS cluster that the app will run on.
const infrStack = new HelloWorldInfrStack(dataStack,'HWDCdkInfrStack',{
  // env tells CDK where to set up the CloudFormation Stacks. We'll use the default account and region
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  // apply these tags to every object created in the stack. 
  tags: app_tags,

  // any additional variables here are because we require them in the definition for the stack.
  // see lib/hello-cdk-stack.ts
  default_vpc_id: default_vpc_id,
  admin_access_nets: admin_access_nets,
  ssh_access_key_name: ssh_access_key_name,
  admin_instance_type: ec2_admin_instance,
  admin_instance_ami_param: ec2_ami_parameter,
  ecs_instance_type: ec2_ecs_instance,
  docker_repository: dataStack.docker_repository,
  gitrepo: dataStack.gitrepo,
  efsFs: dataStack.efsFs,
});

// app Stack sets up the ECS service, codepipeline tasks to rebuild the service, and any resources
// required to present the service.
const appStack = new HelloWorldAppStack(infrStack,'HWCdkAppStack',{
  // env tells CDK where to set up the CloudFormation Stacks. We'll use the default account and region
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  // apply these tags to every object created in the stack. 
  tags: app_tags,

  // any additional variables here are because we require them in the definition for the stack.
  // see lib/hello-cdk-stack.ts
  default_vpc_id: default_vpc_id,
  docker_repository: dataStack.docker_repository,
  gitrepo: dataStack.gitrepo,
  efsFs: dataStack.efsFs,
  loggroup: dataStack.loggroup,
  ssmEnvParam: dataStack.ssmEnvParam,
  secretManagerEnvSecret: dataStack.secretManagerEnvSecret,
  ecsCapacityProvider: infrStack.asgCapacityProvider,
  ecsCluster: infrStack.ecsCluster,
  source_artifact: dataStack.source_artifact,
  build_artifact: dataStack.build_artifact,
});