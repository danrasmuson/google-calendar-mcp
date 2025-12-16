import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import { getKeysFilePath, generateCredentialsErrorMessage, OAuthCredentials } from './utils.js';
import DopplerSDK from '@dopplerhq/node-sdk';

async function loadCredentialsFromFile(): Promise<OAuthCredentials> {
  const keysContent = await fs.readFile(getKeysFilePath(), "utf-8");
  const keys = JSON.parse(keysContent);

  if (keys.installed) {
    // Standard OAuth credentials file format
    const { client_id, client_secret, redirect_uris } = keys.installed;
    return { client_id, client_secret, redirect_uris };
  } else if (keys.client_id && keys.client_secret) {
    // Direct format
    return {
      client_id: keys.client_id,
      client_secret: keys.client_secret,
      redirect_uris: keys.redirect_uris || ['http://localhost:3000/oauth2callback']
    };
  } else {
    throw new Error('Invalid credentials file format. Expected either "installed" object or direct client_id/client_secret fields.');
  }
}

async function loadCredentialsWithFallback(): Promise<OAuthCredentials> {
  // Load from Doppler using the SDK
  try {
    const dopplerToken = process.env.DOPPLER_TOKEN;
    if (!dopplerToken) {
      throw new Error('DOPPLER_TOKEN environment variable not set');
    }

    const doppler = new DopplerSDK({ accessToken: dopplerToken });

    // Fetch all required secrets from Doppler
    const secretsResponse = await doppler.secrets.list('home_automation', 'prd');

    const secrets = secretsResponse.secrets || {};

    const clientId = secrets.GOOGLE_CLIENT_ID?.computed;
    const clientSecret = secrets.GOOGLE_CLIENT_SECRET?.computed;
    const redirectUri = secrets.GOOGLE_REDIRECT_URI?.computed;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('Doppler OAuth credentials not found. Please ensure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are set in Doppler.');
    }

    if (process.env.NODE_ENV !== 'test') {
      process.stderr.write('Loading OAuth credentials from Doppler via SDK\n');
    }

    return {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [redirectUri]
    };
  } catch (error) {
    throw new Error(`Failed to load OAuth credentials from Doppler: ${error instanceof Error ? error.message : error}`);
  }
}

export async function initializeOAuth2Client(): Promise<OAuth2Client> {
  // Always use real OAuth credentials - no mocking.
  // Unit tests should mock at the handler level, integration tests need real credentials.
  try {
    const credentials = await loadCredentialsWithFallback();
    
    // Use the first redirect URI as the default for the base client
    return new OAuth2Client({
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      redirectUri: credentials.redirect_uris[0],
    });
  } catch (error) {
    throw new Error(`Error loading OAuth keys: ${error instanceof Error ? error.message : error}`);
  }
}

export async function loadCredentials(): Promise<{ client_id: string; client_secret: string }> {
  try {
    const credentials = await loadCredentialsWithFallback();
    
    if (!credentials.client_id || !credentials.client_secret) {
        throw new Error('Client ID or Client Secret missing in credentials.');
    }
    return {
      client_id: credentials.client_id,
      client_secret: credentials.client_secret
    };
  } catch (error) {
    throw new Error(`Error loading credentials: ${error instanceof Error ? error.message : error}`);
  }
}