# Cloud-hosted KonOpas metadata generator

Welcome!

This project is intended to provide a cloud-based solution for generating KonOpas metadata from a Google Sheet and committing those
artifacts to your GitHub repository.


## Pre-requisites

You need to have an AWS account.  If you need to create an AWS account, see here:
- https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/

You need to have `aws` installed.  See here:
- https://docs.aws.amazon.com/cli/latest/userguide/install-cliv1.html

You need to have `sam` installed.  See here:
- https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html

You need to have an S3 bucket for this project.  You only need to create it once, ever.  To create the bucket:
- `aws s3 mb s3://YOUR_BUCKET_NAME --region YOUR_REGION`  # Example regions: us-east-1, ap-east-1, eu-central-1, sa-east-1

Set the `S3_BUCKET` environment variable to _YOUR_BUCKET_NAME_ for future commands.


# Assumptions

- This project assumes that you're running in Windows.  If that's not the case, you'll need to edit the package.json `pack` and
`view-bucket` scripts to specify the `S3_BUCKET` environment variable differently, or you'll need to run the steps by-hand at the
command line.


## Deploying (and un-deploying) the KonOpas metadata generator

To deploy the KonOpas metadata generator:
- `npm run deploy`

If you ever want to remove the deployment:
- `npm run delete-stack`

After removing the deployment, you can also choose to clean up the S3 bucket:
- `aws s3 ls s3://YOUR_BUCKET_NAME`
- Per ID output from above command: `aws s3 rm s3://YOUR_BUCKET_NAME/ID_FROM_VIEW_BUCKET`


## Getting the URL of the KonOpas metadata generator

To get the deployed URL of the KonOpas metadata generator:
- `npm run view-stack`
- Note the URL listed in the output.  This is the _KonOpas-Base-URL_.  This URL will be needed in later steps.


## Writing the configuration

The KonOpas metadata generator must be configured for your project before it can generate metadata for your project.

1. Create a GitHub personal access token with the minimum permissions needed to commit code to your project's GitHub repository:
   
   https://help.github.com/en/github/authenticating-to-github/creating-a-personal-access-token-for-the-command-line

   Be sure to record the token ID after generating it; you will not be able to retrieve it later, nor will this toolchain will not reveal it to you later.

2. Create or locate the Google Sheet which holds your convention's programming events which should be converted to KonOpas metadata.

   When you have opened the document for editing on the `program` tab, the URL in your browser will look a lot like this:
  
   https://docs.google.com/spreadsheets/d/**1Qe_AiFvB7wAiCXkb2jhXAN6kA8tBbY0_FTpJz2rXXhs**/edit#gid=**0**

   When you click on the `people` tab, the URL changes to something like this:
  
   https://docs.google.com/spreadsheets/d/**1Qe_AiFvB7wAiCXkb2jhXAN6kA8tBbY0_FTpJz2rXXhs**/edit#gid=**958660582**

   Note the bolded portion in the URLs above.  The _key_ follows the `/d/`, whereas the _gid_ follows the `gid=`
   Take note of the _key_ and both of the _gid_ values. You'll need these in later steps.

3. Create a JSON file with the following structure:
   ```
   {
     "github": {
       "token": "GITHUB PERSONAL TOKEN FROM STEP #1",
       "username": "GITHUB LOGIN ID ASSOCIATED WITH THE TOKEN",
       "reponame": "GITHUB REPOSITORY NAME"
     },
     "repository": {
       "branch": "heads/master",
       "subdir": "SUBFOLDER FOR KONOPAS METADATA, e.g. 2019"
     },
     "gdrive": {
       "program": {
         "key": "KEY FROM STEP #2",
         "gid": "PROGRAM TAB GID FROM STEP #2"
       },
       "people": {
         "key": "KEY FROM STEP #2",
         "gid": "PEOPLE TAB GID FROM STEP #2"
       }
     }
   }
   ```
  
4. Send the configuration

   To send the configuration:
   - `node index.js KONOpAS-BASE-URL/configuration FILENAME-FROM-STEP-#3`


## Local development

Pre-requisites:
- You will need to have docker installed.  Docker ***does not run*** on Windows 10 Home.
  Direct download link (without loginwall) here: https://download.docker.com/win/stable/Docker%20for%20Windows%20Installer.exe


1. Create a file `konopas-publish\local-env.json` that contains the following content:
   ```
   {
     "PublishFunction": {
       "TABLE_NAME": "YOUR_S3_BUCKET_NAME"
     },
     "ConfigurationFunction": {
       "TABLE_NAME": "YOUR_S3_BUCKET_NAME"
     }
   }
   ```

2. In your command shell, set the `AWS_PROFILE` environment variable to equal your local AWS profile name.

3. To run the API locally:
   - `npm run start-local`

4. Use the `index.js` to write your configuration file to your locally deployed instance:
   - `node index.js http://127.0.0.1:3000/configuration FILENAME-FROM-STEP-#3`

5. Navigate your browser to the `publish` endpoint to test your configuration:
   - http://127.0.0.1:3000/publish?convention=_YOUR_CONVENTION_&year=_YOUR_YEAR_

   The value for the query parameters `convention` and `year` must match the `reponame` and `subdir` values in your configuration file, respectively.

6. In your git repository run:
   - `git pull`
   - `git log`

   You should see a commit with a message of `Scripted publish.`

