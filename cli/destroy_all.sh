#!/bin/sh

set -ev

destroy_service.sh &&
create_infrastructure.sh &&
create_data.sh