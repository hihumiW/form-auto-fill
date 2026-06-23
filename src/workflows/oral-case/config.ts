import type {
  AutoSignatureMode,
  SignatureFontConfig,
  SignatureMode,
  SkeletonSignatureConfig,
} from "@/types";

export const ORAL_CASE_CONFIG = {
  listHash: "#/layout/caseManagement/caseHandling/oralProcessing",
  signatureMode: "auto" as SignatureMode,
  autoSignatureMode: "skeleton-strokes" as AutoSignatureMode,
  signatureFonts: [
    {
      name: "霞鹜文楷",
      path: "signature-fonts/LXGWWenKai-Regular.ttf",
    },
    {
      name: "小赖字体",
      path: "signature-fonts/Xiaolai-Regular.ttf",
    },
    {
      name: "悠哉字体",
      path: "signature-fonts/Yozai-Regular.ttf",
    },
  ] satisfies SignatureFontConfig[],
  skeletonSignature: {
    fontSize: 96,
    scaleX: 100,
    slant: -18,
    sampleDensity: 8,
    jitter: 1,
  } satisfies SkeletonSignatureConfig,
  mediationPlace: "调解室",
  mediationResult: "调解成功",
  agreementAmountFallback: "0",
  agreementContents: [
    "经调解人员耐心沟通、居中协调，当事双方充分交换意见后初步达成共识，本次矛盾纠纷顺利得以化解。",
  ],
  saveSleepTime: 3500,
};
