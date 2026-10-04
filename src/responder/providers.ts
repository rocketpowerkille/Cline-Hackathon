import { createHash } from "node:crypto";
import type { RotationReceipt } from "./types.js";

export interface KeyProvider {
  readonly name: string;
  supports(keyName: string): boolean;
  rotate(keyName: string): Promise<RotationReceipt> | RotationReceipt;
  verifyOldRejected(receipt: RotationReceipt): Promise<boolean> | boolean;
}

export class MockKeyProvider implements KeyProvider {
  private readonly rotations = new Map<string, RotationReceipt>();

  constructor(
    readonly name: string,
    private readonly matches: RegExp,
    private readonly verificationSucceeds = true,
  ) {}

  supports(keyName: string): boolean {
    return this.matches.test(keyName);
  }

  rotate(keyName: string): RotationReceipt {
    const existing = this.rotations.get(keyName);
    if (existing) return existing;
    const rotatedAt = new Date().toISOString();
    const oldFingerprint = createHash("sha256").update(`${this.name}:${keyName}:old`).digest("hex").slice(0, 12);
    const receipt: RotationReceipt = {
      provider: this.name,
      keyName,
      receiptId: receiptId(this.name, keyName, oldFingerprint, rotatedAt),
      oldFingerprint,
      rotatedAt,
    };
    this.rotations.set(keyName, receipt);
    return receipt;
  }

  verifyOldRejected(receipt: RotationReceipt): boolean {
    return this.verificationSucceeds
      && receipt.provider === this.name
      && this.supports(receipt.keyName)
      && receipt.receiptId === receiptId(receipt.provider, receipt.keyName, receipt.oldFingerprint, receipt.rotatedAt);
  }

  rotationCount(keyName: string): number {
    return this.rotations.has(keyName) ? 1 : 0;
  }
}

function receiptId(provider: string, keyName: string, oldFingerprint: string, rotatedAt: string): string {
  return createHash("sha256").update(`${provider}:${keyName}:${oldFingerprint}:${rotatedAt}:warden-mock-v1`).digest("hex");
}

export function mockProviders(options: { npmVerification?: boolean; githubVerification?: boolean } = {}): KeyProvider[] {
  return [
    new MockKeyProvider("npm", /(?:^|_)NPM(?:_|$)|NPM_TOKEN/i, options.npmVerification ?? true),
    new MockKeyProvider("github", /GITHUB|GH_TOKEN/i, options.githubVerification ?? true),
  ];
}

export function providerFor(providers: readonly KeyProvider[], keyName: string): KeyProvider | undefined {
  return providers.find((provider) => provider.supports(keyName));
}