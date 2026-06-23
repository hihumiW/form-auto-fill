import smCrypto from 'sm-crypto';

// 第零步：从 CommonJS 格式的 sm-crypto 包中取出 SM2 和 SM4 工具。
const { sm2, sm4 } = smCrypto;

// 第一步：保存 /api/v1/system/config/getCryptoConfig 当前返回的 SM2 配置密文。
export const DEFAULT_CRYPTO_CONFIG_CIPHER =
  '043696710f4cbc7c86b64f3be01efc7bc6b76d3d29a6106aeb4999db083a30ab0c81541cea882802a44d480c1c1330c186a059447493c09a2068665c5eff2ed00465b65d127fa2cdce33ec9f7a36ad9dec5c78bd58bcf7eb006c4b601b0dc802be641fdf822bcdda0b0ad6fd74eb427f3f254e2cdac336172211692593772c1dd22c0fa5e1b371c648e78d52e3878d3991f6102b92d26d3f659de01e7f47c945b91bc92b642206ef5734e83d04a2a49a760e239170c2717be4d09802f16b2cf5de377b1f22b817416c601c5c9d04a265fa74d650b72babdc07415e0eba';

// 第二步：保存目标站点前端 bundle 中硬编码的 SM2 私钥。
export const DEFAULT_SM2_PRIVATE_KEY =
  '00faf8cf5410b3f9092c7b5b551ea36ebe69aa6f24342e180cfb7beab0fd87934f';

// 第三步：把普通字符串转换为目标站点前端使用的十六进制字符串。
export function stringToHex(text) {
  let result = '';

  // 第四步：逐个字符读取编码，并补齐单字符十六进制。
  for (let index = 0; index < text.length; index += 1) {
    const hex = text.charCodeAt(index).toString(16);
    result += hex.length === 1 ? `0${hex}` : hex;
  }

  // 第五步：返回可交给 sm4 使用的十六进制字符串。
  return result;
}

// 第六步：把后端返回的 padding 名称转换为 sm-crypto 需要的名称。
export function normalizePadding(padding) {
  if (padding === 'NoPadding') return 'none';
  if (padding === 'PKCS5Padding') return 'pkcs#5';
  return 'none';
}

// 第七步：解密 getCryptoConfig 返回的 config，得到真正的 SM4 配置。
export function decryptCryptoConfig(
  configCipher = DEFAULT_CRYPTO_CONFIG_CIPHER,
  privateKey = DEFAULT_SM2_PRIVATE_KEY,
) {
  // 第八步：目标站点的 SM2 密文以 04 开头，前端会先去掉这个前缀。
  const cipherWithoutPrefix = configCipher.startsWith('04')
    ? configCipher.substring(2)
    : configCipher;

  // 第九步：使用 SM2 私钥和 C1C3C2 模式解出配置 JSON 字符串。
  const plaintext = sm2.doDecrypt(cipherWithoutPrefix, privateKey, 1);

  // 第十步：把配置 JSON 字符串解析成对象，后续解响应时会使用里面的 sm4 字段。
  return JSON.parse(plaintext);
}

// 第十一步：根据 cryptoConfig 生成 SM4 解密需要的参数。
export function buildSm4Options(cryptoConfig) {
  const sm4Config = cryptoConfig.sm4;

  // 第十二步：把站点配置中的 mode、padding、iv 转换成 sm-crypto 接受的格式。
  return {
    mode: sm4Config.mode.toLowerCase(),
    padding: normalizePadding(sm4Config.padding),
    iv: stringToHex(sm4Config.iv),
  };
}

// 第十三步：解密响应头带 needcrypt 的接口响应体。
export function decryptNeedcryptText(responseCipher, cryptoConfig) {
  const sm4Config = cryptoConfig.sm4;
  const options = buildSm4Options(cryptoConfig);

  // 第十四步：使用 SM4 key、iv、mode、padding 把响应密文还原成 JSON 字符串。
  return sm4.decrypt(responseCipher, stringToHex(sm4Config.key), options);
}

// 第十五步：解密响应头带 needcrypt 的接口响应体，并直接解析成 JSON 对象。
export function decryptNeedcryptJson(responseCipher, cryptoConfig) {
  const plaintext = decryptNeedcryptText(responseCipher, cryptoConfig);

  // 第十六步：目标站点前端也是在解密后立刻 JSON.parse。
  return JSON.parse(plaintext);
}

// 第十七步：使用默认配置直接解密 needcrypt 响应体，适合临时调试。
export function decryptNeedcryptJsonWithDefaultConfig(responseCipher) {
  const cryptoConfig = decryptCryptoConfig();

  // 第十八步：拿默认 config 解出的 SM4 配置去解响应密文。
  return decryptNeedcryptJson(responseCipher, cryptoConfig);
}
