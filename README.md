# This is a proof of concept implementation of a robust hello world service

This CDK project using TypeScript will create a hello world environment using Amazon Web Services

As part of the deployment, this project will create:
* An Elastic Container Service (ECS) cluster running on Elastic Compute Cloud (EC2)
* An Elastic Container Repository (ECR) storing the container image
* An Elasic File System (EFS) volume to store persistent files.
* An EC2 autoscaling group to create or destroy EC2 instances that can write to the ECR or EFS data stores.
* A codecommit repository storing the Dockerfile to create the container image
* A codepipeline to respond to push events to the codecommit repo. This will rebuild and redeploy the container
* An ECR service to run 2 copies of the container as tasks that preferentailly prefer separate availability zones
* When deployed to a WSU-managed AWS account, the EC2 instances will automatically register with Systems Manager
* The container will read and display items stored in Amazon Secrets Manager and Systems Manager Parameter Store
* An Elastic Load Balancer (ELB) to direct clients to the container application instances.

Changes that are requires to make this project work in WSU provided accounts:
Edit the file bin/hello-cdk.ts and change the following variables:
* default_vpc_id: WSU AWS accounts are deployed using a shared "peering" and Vpc. Change the default_vpc_id to match that provided by the peering account.
* admin_access_nets: Use your Role Based Network or WSU VPN network and egress points.
* ssh_access_key_name: use a precreated SSH key pair that you've enrolled using the AWS console.


## To deploy:

* Make changes to the app to use your pre-created virtual private network, role based access network, and ssh key
* Log in to AWS SSO for your organization and get the access keys via the CLI option, save to the
  command environment where you will run CDK.
* Deploy the data layer: `cdk deploy HWCdkDataStack`
* Deploy the infrastrucutre layer: `cdk deploy HWCdkDataStack/HWCdkAppStack`
* Use the admin AutoScaling Group to create the initial docker image
    * Start an admin instance: `aws autoscaling update-auto-scaling-group --auto-scaling-group-name HelloWorldAdminAsg --desired-capacity 1`
    * Find the admin instance: `aws ec2 describe-instances --filters Name=tag:aws:autoscaling:groupName,Values=HelloWorldAdminAsg`
    * Wait for the admin instance to start and settle, then connect using SSH to the private IP **Note that you must be connecting from the admin network you specified above**
    * Once connected, create the docker image:
        sudo -i
        git config --global credential.helper '!aws codecommit credential-helper $@'
        git config --global credential.UseHttpPath true
        ACCOUNT=`aws sts get-caller-identity --output text | awk '{print $1}'`

        git clone https://git-codecommit.us-west-2.amazonaws.com/v1/repos/HelloWorld
        cd HelloWorld

        aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.us-west-2.amazonaws.com
        docker build -t helloworldrepo .
        docker tag helloworldrepo:latest $ACCOUNT.dkr.ecr.us-west-2.amazonaws.com/helloworldrepo:latest
        docker push $ACCOUNT.dkr.ecr.us-west-2.amazonaws.com/helloworldrepo:latest

    * While the admin instance is running, put some contents in the EFS volume:
        echo "this is the contents of a file" >> /efs/foo.txt
* Terminate the admin instance by adjusting the autoscaling group:  `aws autoscaling update-auto-scaling-group --auto-scaling-group-name HelloWorldAdminAsg --desired-capacity 0`
* Deploy the service layer: `cdk deploy HWCdkDataStack/HWDCdkInfrStack/HWCdkAppStack`

To remove:
 * First remove the CloudFormat


The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
* `cdk destroy`     remove the stack to your aws account/region. Note that resources with content, such as ECR registries with container images may require manual intervention.
