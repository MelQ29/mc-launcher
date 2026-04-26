/**
 * Optional Microsoft OAuth flow.
 *
 * The launcher hands off to the official Minecraft Launcher by default, so
 * authentication is not implemented here. This stub keeps the API surface
 * stable in case a future build wants to embed direct launching.
 *
 * To implement: device-code or auth-code flow against
 * https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode , then
 * exchange Microsoft -> Xbox Live -> XSTS -> Minecraft to obtain an access
 * token usable when spawning Java directly with the Minecraft client jar.
 */

export interface AuthSession {
  accessToken: string;
  username: string;
  uuid: string;
  expiresAt: number;
}

export class OAuthStub {
  /** Always rejects — direct launching is not enabled in this build. */
  async login(): Promise<AuthSession> {
    throw new Error(
      'Direct Minecraft launch is disabled. The launcher uses the official Minecraft Launcher; ' +
      'enable this stub by implementing the Microsoft -> XBL -> XSTS -> Minecraft token exchange.',
    );
  }

  async refresh(): Promise<AuthSession> { return this.login(); }
}
