#!/bin/sh

set -ev

create_data.sh &&
create_infrastructure.sh &&
create_service.sh