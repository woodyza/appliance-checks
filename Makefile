.PHONY: push deploy test-url

# Push local code to Apps Script
push:
	clasp push --force

# Get the latest deployment ID
get-latest-deployment-id:
	@clasp deployments | head -3 | tail -1 | awk '{print $$2}'

# Push and update the latest deployment with a new version
deploy: push
	@DEPLOYMENT_ID=$$(clasp deployments | head -3 | tail -1 | awk '{print $$2}') && \
	clasp deploy --deploymentId $$DEPLOYMENT_ID --description "Mangawhai Truck Checks"

# Get the URL of the most recent test (HEAD) deployment
test-url:
	@clasp deployments | grep "@HEAD" | awk '{print "https://script.google.com/macros/s/" $$2 "/exec"}'
