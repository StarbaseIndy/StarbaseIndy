# Overview

This project offers the following capabilities:
- Docker definition file and supporting package.json scripting to build and use a docker container offering the `aws` and `sam` commands, which are needed to deploy applications to the AWS cloud as a CloudFormation stack
- Docker definition file and supporting package.json scripting to launch an X11 VNC docker container mapped to your current working directory, AWS credentials directory, and docker control socket such that all CLoundFormation development can be performed within the VM, with the artifacts stored in your local working directory.

# Prerequisites

## Docker for Windows 10 Pro
This project requires Docker, which can be installed on Windows 10 Pro.
Direct download link (without loginwall) here: https://download.docker.com/win/stable/Docker%20for%20Windows%20Installer.exe

## Docker for Windows 10 Home

If you're running Windows 10 Home, then Docker for Windows will not run on your machine.
You can alternatively install a set of tools that will allow docker commands to execute via VirtualBox and docker-machine:
https://www.sitepoint.com/docker-windows-10-home/

Follow the instructions for using chocolatey.

Be sure to configure port forwarding for VNC, which is 5900:5900

For volume mounts, if your development directory is not under c:\Users, then the following folder need to be configured:
- Working directory
  - Folder path: wherever you'll be developing, e.g. C:\temp
  - Mount point: /var/workspace
  - Read-only: no
  - Auto-mount: yes
  - Make permenant: yes

Note: You should be able to run `npm run sh` and then, inside that shell, `ls` and see your chosen working directory (as mapped by the `launch.js` script). If that doesn't work, try running (from a git bash prompt) `docker-machine restart default`.

Additionally, before any of the package.json scripts will work, you'll need to:
- Restart VSCode
- Initialize the environment variables in your powershell:
  - `& "C:\ProgramData\chocolatey\lib\docker-machine\bin\docker-machine.exe" env default --shell powershell | Invoke-Expression`

Note that the package.json commands will not work in Git Bash.  Sorry.

# Build the docker containers

Do this once to make the `aws` and `sam` commands available to you:
- `npm run docker-build`


# Getting started with AWS:

Follow the steps outlined in "Tutorial: Deploying a Hello World Application"
- https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started-hello-world.html


When you need to run an `aws` or `sam` command, you can do so via `npm run aws` and `npm run sam`, respectively, e.g.
- `npm run aws configure`

Notes:
- The `alpine` user in the X11/VNC virtual machine does not have root permissions by default.  For instance, that user would need to use `sudo` to run a docker command.
- The virtual machine path `/root/.aws` is mounted as read-write, so commands issued in this way can write your credentials.
- The virtual machine path `/home/alpine/.aws` is mounted as read-only.


# Usage

From Powershell:
- `npm run sh` will open a shell in the aws/sam container
- `npm run bash` will open a shell in the X11/VNC container
- `npm run x11-vnc-ssh` will run the X11 server in the X11/VNC container.  Just point your VNC client to `localhost` to get into it.
  - The default user is `alpine`
  - The password for both `alpine` and `root` is: `alpine`

# Other resources

Check out the concepts here:
 - https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-getting-started-hello-world.html
 - https://docs.aws.amazon.com/lambda/latest/dg/with-on-demand-https-example.html
 - https://docs.aws.amazon.com/lambda/latest/dg/with-ddb-example.html
 - https://github.com/awslabs/aws-sam-cli

