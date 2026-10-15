export const app = { getPath: () => process.env.TEMP + '/khwp-ai-test' };
export const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString().slice(4) };
