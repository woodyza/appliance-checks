JAVA_HOME_21 ?= /opt/homebrew/opt/openjdk@21
EMULATOR_PATH := $(JAVA_HOME_21)/bin:$(PATH)

.PHONY: check lint typecheck test test-unit test-emulator dev deploy \
	apps-script-push apps-script-deploy apps-script-test-url

# Lint, typecheck and run the full test suite (unit + emulator).
check: lint typecheck test

lint:
	npm run lint

typecheck:
	npm run typecheck

test: test-unit test-emulator

test-unit:
	npm run test:unit

# firebase-tools' Firestore emulator requires Java 21+; the system default may be older,
# so this prepends Homebrew's openjdk@21 to PATH. Override JAVA_HOME_21 if yours lives elsewhere.
test-emulator:
	PATH="$(EMULATOR_PATH)" npm run test:emulator

# Run these in two terminals (the emulators need Java 21+ on PATH, see test-emulator above):
#   PATH="$(EMULATOR_PATH)" npm run emulators
#   npm run dev
dev:
	@echo 'Run in one terminal: PATH="$(EMULATOR_PATH)" npm run emulators'
	@echo 'Run in another:      npm run dev'

# make deploy ENV=dev|prod
deploy:
	npx tsx cli/deploy.ts --project $(ENV)

# Apps Script app in apps-script/ (clasp installed globally, see apps-script/README.md).
apps-script-push:
	cd apps-script && clasp push --force

apps-script-deploy: apps-script-push
	@DEPLOYMENT_ID=$$(cd apps-script && clasp deployments | head -3 | tail -1 | awk '{print $$2}') && \
	cd apps-script && clasp deploy --deploymentId $$DEPLOYMENT_ID --description "Mangawhai Truck Checks"

apps-script-test-url:
	@cd apps-script && clasp deployments | grep "@HEAD" | awk '{print "https://script.google.com/macros/s/" $$2 "/exec"}'
