#!/bin/sh

set -ev

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

# Create Security Group(s)

# Create Security Group Rules

# Create Instance Profiles

# Create Launch Configurations

# Create AutoScalingGroups

# Create ASG Drain Hooks for ECS

# Create Capacity Provider

# Create Roles

# Create Cluster

# Create Role Policies


# at this point, we have a cluster that is capable of automatically growing to support tasks that run on it.
