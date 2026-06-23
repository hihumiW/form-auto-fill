import {
  decryptCryptoConfig,
  decryptNeedcryptJson,
} from '../src/crypto/cq12348-crypto.js';

// 第一步：从命令行参数中读取真实接口返回的 needcrypt 响应密文。
const responseCipher = process.argv[2];

// 第二步：解开 getCryptoConfig 的 config，得到当前会话使用的 SM4 配置。
const cryptoConfig = decryptCryptoConfig();

// 第三步：打印解出的 SM4 配置，方便确认 key、iv、mode、padding 是否正确。
console.log('解出的 cryptoConfig：');
console.log(JSON.stringify(cryptoConfig, null, 2));

// 第四步：如果没有传入响应密文，就只展示 cryptoConfig 并结束。
if (!responseCipher) {
  console.log('如果要解密响应体，请执行：node scripts/cq12348-crypto-demo.js <响应体密文>');
  process.exit(0);
}

// 第五步：使用 cryptoConfig 中的 SM4 参数解密 needcrypt 响应体。
const responseJson = decryptNeedcryptJson(responseCipher, cryptoConfig);

// 第六步：打印解密后的真实 JSON。
console.log('解出的响应 JSON：');
console.log(JSON.stringify(responseJson, null, 2));

