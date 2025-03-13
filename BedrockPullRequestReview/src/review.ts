import fetch from 'node-fetch';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { git } from './git';
import { addCommentToPR } from './pr';
import { Agent } from 'https';
import * as tl from 'azure-pipelines-task-lib/task';

export async function reviewFile(targetBranch: string, fileName: string, httpsAgent: Agent) {
  console.log(`Start reviewing ${fileName} ...`);

  const patch = await git.diff([targetBranch, '--', fileName]);

  const instructions = `Act as a code reviewer of a Pull Request, providing feedback on possible bugs and clean code issues.
        You are provided with the Pull Request changes in a patch format.
        Each patch entry has the commit message in the Subject line followed by the code changes (diffs) in a unidiff format.

        As a code reviewer, your task is:
                - Review only added, edited or deleted lines.
                - If there's no bugs and the changes are correct, write only 'No feedback.'
                - If there's bug or uncorrect code changes, don't write 'No feedback.'`;


  const prompt = `${instructions}\n\nPatch:\n${patch}`;

  const bedrockClient = new BedrockRuntimeClient({
    region: tl.getVariable('AWS_REGION') || 'us-east-1',
    credentials: {
      accessKeyId: tl.getVariable('AWS_ACCESS_KEY_ID') || '',
      secretAccessKey: tl.getVariable('AWS_SECRET_ACCESS_KEY') || '',
    },
  });

  const bedrockModelId = tl.getInput('bedrockModelId') || 'anthropic.claude-3-sonnet-20240229-v1:0';

  try {
    const params = {
      modelId: bedrockModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt,
        max_tokens_to_sample: 500,
        temperature: 0,
      }),
    };

    const command = new InvokeModelCommand(params);
    const response = await bedrockClient.send(command);

    const decodedResponseBody = new TextDecoder().decode(response.body);
    const responseBody = JSON.parse(decodedResponseBody);

    const review = responseBody.completion.trim();

    if (review !== "No feedback.") {
      await addCommentToPR(fileName, review, httpsAgent);
      console.log(`Comment added to PR for ${fileName}`);
    } else {
      console.log(`No feedback for ${fileName}`);
    }

    console.log(`Review of ${fileName} completed.`);
  }
  catch (error: any) {
    tl.error(`Error invoking AWS Bedrock: ${error.message || error}`);
    throw error;
  }
}

