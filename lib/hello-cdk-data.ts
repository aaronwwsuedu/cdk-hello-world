import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';

// require path so we can reference local code to put initial commit into codecommit
var path = require('path');

interface HelloWorldDataStackProps extends cdk.StackProps {
  default_vpc_id: string;
};

//
// Data stack contains data elements like Properties, EFS, S3, etc. These resources are typically not
// destroyed with the CloudFormation Stack.
//
export class HelloWorldDataStack extends cdk.Stack {
  public efsFs: efs.FileSystem;
  public docker_repository: ecr.Repository;
  public gitrepo: codecommit.Repository;
  public ssmEnvParam: ssm.StringParameter;
  public secretManagerEnvSecret: secrets.Secret;
  public loggroup: logs.LogGroup;

  public source_artifact: codepipeline.Artifact;
  public build_artifact: codepipeline.Artifact;


  constructor(scope: Construct, id: string, props: HelloWorldDataStackProps) {
    super(scope, id, props);

    // artifacts to store pipeline output.
    this.source_artifact = new codepipeline.Artifact('HelloWorldSourceArtifact');
    this.build_artifact = new codepipeline.Artifact('HelloWorldBuildArtifact');

    // WSU uses a peering account to define the VPC. use the default_vpc_id to define the VPC object
    const default_vpc = ec2.Vpc.fromLookup(this,'DefaultVpc',{ vpcId: props.default_vpc_id})

    // create the group too.
    this.loggroup = new logs.LogGroup(this,'HelloWorldLogGroup',{
      //encryptionKey: new kms.Key(this,'HelloWorldCWKey'),
      retention: logs.RetentionDays.SIX_MONTHS,
    });

    // create a docker repository to store our test docker container image. 
    this.docker_repository = new ecr.Repository(this,'HelloWorldECRepo',{
      encryption: ecr.RepositoryEncryption.AES_256,
      repositoryName: 'helloworldrepo',
      // image scan on push at the repository level is depreciated, accounts should instead set a scan policy at the registry
      // level to apply to all repositories, but if leaving this unset or false will generate a Security Hub Finding.
      imageScanOnPush: true, 
    });
    // add lifecycle rules to automatically remove old images. This improves our security posture by removing stale data, and reduces our
    // Amazon Inspector costs by reducing the number of images to scan.
    this.docker_repository.addLifecycleRule({
      description: "Maintain no more than 5 tagged images",
      maxImageCount: 5,
      tagStatus: ecr.TagStatus.ANY,
    }),
    this.docker_repository.addLifecycleRule({
      description: "Restrict repo to 1 untagged image",
      maxImageCount: 1,
      tagStatus: ecr.TagStatus.UNTAGGED
    })

    // create a git repo to store the Dockerfile for our hello world container
    this.gitrepo = new codecommit.Repository(this,'HelloWorld',{
      repositoryName: 'HelloWorld',
      description: "Hello World demo container source",
      code: codecommit.Code.fromDirectory(path.join(__dirname,'..','hello-world-container')),
      
    });

    // create a systems manager parameter to store a value
    this.ssmEnvParam = new ssm.StringParameter(this,'HelloWorldSsmParam',{
      description: "a parameter needed by hello world",
      parameterName: '/helloworld/development/test_ssm_param',
      tier: ssm.ParameterTier.STANDARD,
      stringValue: "this came from Systems Manager Parameter Store",
    })
    // create a secret that will store a secret value
    this.secretManagerEnvSecret = new secrets.Secret(this,'dockerSecret',{
      secretStringValue: cdk.SecretValue.unsafePlainText("this came from Secrets Manager. Because it's stored in a template, this should not be a real secret."),
      secretName: 'helloworldsecret'
    })

    // Create EFS volume for files. EFS volume will be available to admin EC2 nodes we created above, and to the container we create below. The container will only 
    // get read access.
    this.efsFs = new efs.FileSystem(this,'HelloWorldExternalFiles',{
      vpc: default_vpc,
      enableAutomaticBackups: true,
      encrypted: true,
      fileSystemName: 'HelloWorldEFS'
    });

  }
};