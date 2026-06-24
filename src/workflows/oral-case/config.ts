import type {
  AutoSignatureMode,
  SignatureMode,
} from "@/types";

export const ORAL_CASE_CONFIG = {
  listHash: "#/layout/caseManagement/caseHandling/oralProcessing",
  signatureMode: "auto" as SignatureMode,
  autoSignatureMode: "hanzi-medians" as AutoSignatureMode,
  mediationPlace: "调解室",
  mediationResult: "调解成功",
  agreementAmountFallback: "0",
  agreementContents: [
    "经调解人员耐心沟通、居中协调，当事双方充分交换意见后初步达成共识，本次矛盾纠纷顺利得以化解。",
  ],
  saveSleepTime: 1500,
};
