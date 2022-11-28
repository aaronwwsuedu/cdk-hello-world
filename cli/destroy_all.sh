#!/bin/sh

set -ev

destroy_service.sh &&
destroy_infrastructure.sh &&
destroy_data.sh
