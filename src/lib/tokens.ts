/**
 * Canonical Robinhood Stock Tokens and tokenized ETFs on Robinhood Chain.
 *
 * Source: docs.robinhood.com/chain/contracts, supplied by the operator from
 * the page itself. That page is explicit about why this file exists:
 *
 *   "Use the addresses on this page to identify the canonical Robinhood
 *    Stock Token for each underlying — a token with a matching name/ticker
 *    but a different contract address is not a Robinhood Stock Token."
 *
 * Integrity: all 194 addresses were checked for shape and uniqueness,
 * and 193 carry a valid EIP-55 checksum (LLY is published
 * all-lowercase, which is a legal unchecksummed form). A mistyped character
 * would almost certainly break its checksum, so this is a real transcription
 * check rather than a formatting one. test/registry.test.mjs re-runs it on
 * every commit.
 *
 * NOT verified on-chain — this environment cannot reach Robinhood Chain.
 * `npm run verify:chain` reads each token's symbol() back and compares.
 */

export type TokenEntry = { address: string; name: string };

/** Tradable underlyings. 177 entries. */
export const STOCK_TOKENS: Record<string, TokenEntry> = {
  AAOI: {
    address: "0x521Cf887E6531c6F667b5BC4D896E5d9bfE8EB2E",
    name: "Applied Optoelectronics",
  },
  AAPL: {
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    name: "Apple",
  },
  ABCL: {
    address: "0x3139D77Ace0cbAA5bDfD38bD1F1911a794AF0B0e",
    name: "Abcellera Biologics",
  },
  ADBE: {
    address: "0x232B8ed6377BE97813853B0Ac104c4Cda8378d1B",
    name: "Adobe",
  },
  AEHR: { address: "0x5F604fBA1162193A4388A5DFa56F556f3E133cC2", name: "Aehr" },
  AEIS: {
    address: "0xfAf9cb261B5FCC1f404Bb10CD39C5c6C1974E612",
    name: "Advanced Energy",
  },
  ALAB: {
    address: "0x748c32c3ca24eDf31ea597Db1F3d330a7a6DA3Dc",
    name: "Astera Labs, Inc.",
  },
  AMAT: {
    address: "0x36046893810a7E7fCE501229d57dc3FC8c8716d0",
    name: "Applied Materials",
  },
  AMBA: {
    address: "0x99D9D8663545151603863C5AcbD6FC3218899009",
    name: "Ambarella",
  },
  AMC: {
    address: "0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B",
    name: "AMC Entertainment",
  },
  AMD: { address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", name: "AMD" },
  AMKR: {
    address: "0xDd356AA38F40A7b7076755aC854B6FBb1F0D305B",
    name: "Amkor Technology",
  },
  AMZN: {
    address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
    name: "Amazon",
  },
  ANET: {
    address: "0x28bABD556b60E53663B8615036479a29c2CDd1Bf",
    name: "Arista",
  },
  APLD: {
    address: "0xb8DBf92F9741c9ac1c32115E78581f23509916FD",
    name: "Applied Digital",
  },
  APP: {
    address: "0xA249BAF1063Af884807C1E1400AEf7784836917E",
    name: "AppLovin",
  },
  ASML: {
    address: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA",
    name: "ASML Holding NV",
  },
  ASTS: {
    address: "0x1AF6446f07eb1d97c546AFC8c9544cBDF3AD5137",
    name: "AST SpaceMobile",
  },
  AUR: {
    address: "0x373C06c4f7BDe527D7Dae4BA169E42b55E393CeD",
    name: "Aurora Innovation",
  },
  AVAV: {
    address: "0xF6290b5e7C26502e2dA514C31509849718EA76A5",
    name: "AeroVironment",
  },
  AVGO: {
    address: "0x156E175DD063a8cE274C50654eF40e0032b3fbcF",
    name: "Broadcom",
  },
  AXON: { address: "0xC27dBD474aF5181c5A8777903690D8D262D12648", name: "Axon" },
  AXTI: { address: "0x141eEa040c2250eEc0314e336975e81f85f6585e", name: "AXT" },
  BA: { address: "0x4D21483a44Bf67a86b77E3dA301411880797D452", name: "Boeing" },
  BABA: {
    address: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4",
    name: "Alibaba",
  },
  BB: {
    address: "0x48E39E56aCdbA37b09020C0b734A613C9a2f100A",
    name: "Blackberry",
  },
  BE: {
    address: "0x822CC93fFD030293E9842c30BBD678F530701867",
    name: "Bloom Energy",
  },
  BULL: {
    address: "0xceF9027c7d6985b85f0BA431125073529A947A68",
    name: "Webull",
  },
  CBRS: {
    address: "0x5c90450Bbb4273D7b2f17CF6917AEB237A569679",
    name: "Cerebras Systems",
  },
  CCL: {
    address: "0x9651342CeA770aE9a2969Ba2A52611523146aef9",
    name: "Carnival Corporation",
  },
  CEG: {
    address: "0xaE517A2903E68bd929Dfd15be875F8369D53e94a",
    name: "Constellation Energy",
  },
  CELH: {
    address: "0x8cF07C5A878945185d327aAa6e33FAa95F95e7bF",
    name: "Celsius",
  },
  CIEN: {
    address: "0x44f6D488021f8233B9416294d1FE9b1fEe28382d",
    name: "Ciena",
  },
  CLOV: {
    address: "0x62200915e7DEab1eC7f79fb246daDbB80eACdDd0",
    name: "Clover Health Investments",
  },
  CLS: {
    address: "0xBf449977089c718C004a66C554B26B94ef3Ad4De",
    name: "Celestica",
  },
  CLSK: {
    address: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3",
    name: "CleanSpark",
  },
  COHR: {
    address: "0x92F9F459F1a9a5AD266b182BE7Bffd1C6c666894",
    name: "Coherent",
  },
  COIN: {
    address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
    name: "Coinbase",
  },
  COST: {
    address: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2",
    name: "Costco",
  },
  CRCL: {
    address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5",
    name: "Circle Internet Group",
  },
  CRDO: {
    address: "0x4D67253bc223e6b0e104F1084c1fb2b669dDC41b",
    name: "Credo Technology Group",
  },
  CRM: {
    address: "0xd95B44124e475743a7589e68F3D74008A5536D44",
    name: "Salesforce",
  },
  CRWD: {
    address: "0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931",
    name: "CrowdStrike Holdings",
  },
  CRWV: {
    address: "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3",
    name: "CoreWeave",
  },
  CSCO: {
    address: "0xF543967EEBB6f1917992eF0E68De63ab07a5a0dA",
    name: "Cisco Systems",
  },
  CTSH: {
    address: "0x63D5a3b6939a33f1e75d8Bcd85759858239600DB",
    name: "Cognizant",
  },
  CVNA: {
    address: "0xa4f319104089FE321dc8093C6E707d4fE190A988",
    name: "Carvana",
  },
  DDOG: {
    address: "0x27c99fBde9D0d2AA4f4Bfb4943f237843DdF6958",
    name: "Datadog",
  },
  DELL: { address: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", name: "Dell" },
  DJT: {
    address: "0x1D11f0496982706C5e14A514D4E79F2e6BdE4516",
    name: "Trump Media & Technology Group",
  },
  DOCN: {
    address: "0xc02f12B9fe9E707079EC0d546f3050d3F6C1F8bD",
    name: "DigitalOcean",
  },
  ELF: {
    address: "0x39EC44Bee4F6A116c6F9B8De566848a985C53C60",
    name: "e.l.f. Beauty",
  },
  F: {
    address: "0x25C288E6D899b9BC30160965aD9644c67e73bE0C",
    name: "Ford Motor",
  },
  FICO: {
    address: "0xa48F22A46C0F1C46CA7D111CB6c137c271987180",
    name: "Fair Isaac",
  },
  FIG: { address: "0x41F4267525a8AFf329540eF24fD83d9044758B33", name: "Figma" },
  FISV: {
    address: "0x9ECe29A4A2397C0a35fb5fA8EE2b9509130a98cc",
    name: "Fiserv",
  },
  FIX: {
    address: "0x93Dbb1d2Dc5D63F4abACFF30485273f538Df68Ac",
    name: "Comfort Systems",
  },
  FLNC: {
    address: "0x282e87451E10fA6679BC7D76C69BE44cD3fC777C",
    name: "Fluence Energy",
  },
  FLY: {
    address: "0x03BC731Ffb162cdd7B98D3C6542bFC291126075d",
    name: "Firefly Aerospace Inc.",
  },
  FTNT: {
    address: "0x3FB8976980d486084b2eb4a404BD12e72823958f",
    name: "Fortinet",
  },
  FUTU: {
    address: "0xeB30663bDFf0622Ef4e4E5cBb4E975F19f33f51D",
    name: "Futu Holdings",
  },
  GE: {
    address: "0x63b814DDBd6BF339f25Fed8c36158a008D5B373e",
    name: "General Electric",
  },
  GEV: {
    address: "0x94B8AAE43A1cCc08Aa64B7D1F29b4D920aF4a0C9",
    name: "GE Vernova",
  },
  GLW: {
    address: "0x7c04E6A3368F2A1DE3874f0e80d2e0A1a9915da6",
    name: "Corning",
  },
  GLXY: {
    address: "0x2D427692E928fa156ec22acfaBaFA0447C5805B7",
    name: "Galaxy Digital Inc.",
  },
  GME: {
    address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E",
    name: "GameStop",
  },
  GOOGL: {
    address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
    name: "Alphabet Class A",
  },
  HII: {
    address: "0xEB61c0Ed490A367d4E3631cCf8a74B3bfc7E775D",
    name: "Huntington Ingalls",
  },
  HIMS: {
    address: "0xCceE82fE024c36fA15E1005edE3E9e4787e23D09",
    name: "Hims & Hers Health",
  },
  HPE: {
    address: "0x59dd09d4900C2E4B5F75b7c0d4E6796fcc234Cb1",
    name: "HP Enterprise",
  },
  HWM: {
    address: "0xAEa445c5F3DB1a462998ccC422A875A361ee5d99",
    name: "Howmet Aerospace",
  },
  IBM: { address: "0x980dcf6766FA79f5Cf0c4AAdb3ab477ff15a9619", name: "IBM" },
  IBRX: {
    address: "0x7c148F74ac7445D1F28366b7FcDC6792a9Fcd0Cf",
    name: "ImmunityBio,",
  },
  INFQ: {
    address: "0xB853bC83a753342a4f8320ea680b4B1E84118D21",
    name: "Infleqtion",
  },
  INOD: {
    address: "0xf1953DAB6FaD537488d5A022361FfAa8B4c95eC6",
    name: "Innodata",
  },
  INTC: {
    address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681",
    name: "Intel",
  },
  INTU: {
    address: "0x56d23beE5f41A7120170b0c603Dae30128e460e9",
    name: "Intuit",
  },
  IONQ: { address: "0x558378E000D634A36593E338eBacdd6207640EfE", name: "IonQ" },
  IREN: {
    address: "0xF0AB0c93bE6F41369d302e55db1A96b3c430212D",
    name: "IREN Limited",
  },
  JBL: {
    address: "0xEAf2512dFC1bEAc608F8794B3793CD4E02894Aa6",
    name: "Jabil Inc.",
  },
  JNJ: {
    address: "0x03DfbBE0AC4E7bCDaFd08eD41A400326B77D8c80",
    name: "Johnson & Johnson",
  },
  JOBY: {
    address: "0xb334C5cE741B80B5B671F47F5C269Cb193fe8E24",
    name: "Joby Aviation",
  },
  KLAC: { address: "0x96b933C74eCB4A0926b9210cef7b743EF46be2E9", name: "KLA" },
  KSS: {
    address: "0x12e3c047bf9AeCAF9dDC98c05C31BFD1dd043993",
    name: "Kohls Corporation",
  },
  KTOS: {
    address: "0x7FD06a4d81cCfA3F351394E144d5191874C31313",
    name: "Kratos Defense & Security Solutions",
  },
  LHX: {
    address: "0x48d60243c66437c6ac3c2495Be94747aEd5Dfe25",
    name: "L3Harris",
  },
  LITE: {
    address: "0x8eF20885F94e3D9bc7eB3080279188Bd5ED7c08C",
    name: "Lumentum",
  },
  LLY: {
    address: "0x8005d266423c7ea827372c9c864491e5786600ea",
    name: "Eli Lilly",
  },
  LMT: {
    address: "0x329fcACEb9AD6F9580DD5F643fed0646900D043c",
    name: "Lockheed",
  },
  LRCX: {
    address: "0x57b0030166DB0C31690d1A5aA167e2e26e2C29a4",
    name: "Lam Research Corp",
  },
  LULU: {
    address: "0x4e62068525Ab11FE768e29dfD00ef909B9803016",
    name: "Lululemon",
  },
  LUNR: {
    address: "0xa5D4968421bA94814Be3B136b15cf422101aC1a3",
    name: "Intuitive Machines",
  },
  MDB: {
    address: "0xDdf2266b79abf0B48898959B0ed6E6adf512be74",
    name: "MongoDB",
  },
  META: {
    address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
    name: "Meta Platforms",
  },
  MOD: {
    address: "0xc6Cbad1016b38B797610c25E1dc7D95988B1f362",
    name: "Modine",
  },
  MPWR: {
    address: "0x52D50D0280AD1054b43f052bD70a49a212A1b128",
    name: "Monolithic Power Systems",
  },
  MRNA: {
    address: "0x43B07D15cE533bEc5476d70C22a78a1B2B662155",
    name: "Moderna",
  },
  MRVL: {
    address: "0x62fd0668e10D8B72339BE2DCF7643001688ff13B",
    name: "Marvell Technology",
  },
  MSFT: {
    address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    name: "Microsoft",
  },
  MSTR: {
    address: "0xec262a75e413fAfD0dF80480274532C79D42da09",
    name: "Strategy Inc.",
  },
  MTSI: {
    address: "0xC93f4d80e268AB922e871bd169156C3CC41894e6",
    name: "MACOM",
  },
  MU: {
    address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD",
    name: "Micron Technology",
  },
  MXL: {
    address: "0x48961813349333209994750ffA89b3c5C22eC969",
    name: "MaxLinear",
  },
  NAVN: {
    address: "0xf7181b63Fdb858558A74ba96BC42732684cd7965",
    name: "Navan",
  },
  NBIS: {
    address: "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931",
    name: "Nebius Group",
  },
  NET: {
    address: "0x116F00968269B7bfbaD4109cE591d6E74c0601d4",
    name: "Cloudflare, Inc. Class A common stock",
  },
  NFLX: {
    address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
    name: "Netflix",
  },
  NNE: {
    address: "0xBEF75684C43c4ea7BD18Dd532a2244674Ee8b926",
    name: "Nano Nuclear Energy",
  },
  NOW: {
    address: "0x0C3260aF4B8f13a69c4c2dFb84fD667890CDFa14",
    name: "ServiceNow",
  },
  NU: { address: "0x408c14038a04f7bD235329E26d2bf569ee20e250", name: "Nu" },
  NVDA: {
    address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    name: "NVIDIA",
  },
  NVTS: {
    address: "0xbE6702d7b70315376dC48a3293f24f0982F86386",
    name: "Navitas Semiconductor",
  },
  OKLO: { address: "0x8B2f88497f15A18E9D4FFa1a8fFB8538399aE774", name: "Oklo" },
  ON: {
    address: "0xbBD09F72b025360FeE5C928053Dca6248d35be54",
    name: "ON Semiconductor",
  },
  ONTO: {
    address: "0x8ff63eAeEe3fE54Ba450c4F5538064Ec5A893Aef",
    name: "Onto Innovation",
  },
  ORCL: {
    address: "0xb0992820E760d836549ba69BC7598b4af75dEE03",
    name: "Oracle",
  },
  OUST: {
    address: "0x40E7a279850e443f582059ae5dC1c3b6563E6395",
    name: "Ouster",
  },
  P: {
    address: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D",
    name: "Everpure",
  },
  PANW: {
    address: "0xB039597eD45CBa7B6E2fb9E8BE51802969CEe5Be",
    name: "Palo Alto Networks",
  },
  PATH: {
    address: "0xfb2664f07B6Aadd29ea7a59D8859b1AeB8645cDa",
    name: "UiPath",
  },
  PENG: {
    address: "0x9b23573b156B52565012F5cE02CDF60AFBaa70Be",
    name: "Penguin Solutions",
  },
  PFE: {
    address: "0x7066A64c24e4206CD62E83bf198c1E7EB361F51e",
    name: "Pfizer",
  },
  PL: {
    address: "0xAA4d64474c172010aB57719cb9951E6142a100d3",
    name: "Planet Labs",
  },
  PLTR: {
    address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
    name: "Palantir Technologies",
  },
  POET: {
    address: "0xcf6B2D875361be807EAfa57458c80f28521F9333",
    name: "POET Technologies",
  },
  POWL: {
    address: "0x237c16D66590F67B886d978ACD362EAeaD8B18c7",
    name: "Powell Industries",
  },
  PR: {
    address: "0x4189F0c66EBBB0bfeF1C31f763131361EF32f77C",
    name: "Permian Resources",
  },
  PWR: {
    address: "0x9Ab02Ead789b6903c3c44d0ED32F9c707CDF12FD",
    name: "Quanta",
  },
  QBTS: {
    address: "0xC583c60aeF9Dc401Da72cEC1B404743a93cea1Cc",
    name: "D-Wave Quantum Inc. Common Stock",
  },
  QCOM: {
    address: "0x0f17206447090e464C277571124dD2688E48AEA9",
    name: "Qualcomm",
  },
  QUBT: {
    address: "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4",
    name: "Quantum Computing",
  },
  RBLX: {
    address: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8",
    name: "Roblox",
  },
  RCAT: {
    address: "0xFDE6b5d9BB419B10C23268c74e369AbFF39C0460",
    name: "Red Cat",
  },
  RDDT: {
    address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C",
    name: "Reddit",
  },
  RDW: {
    address: "0x92Ef19E82bD8fF36661DE838D5eaE7e5CEF0EfFE",
    name: "Redwire",
  },
  RGTI: {
    address: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba",
    name: "Rigetti Computing",
  },
  RIVN: {
    address: "0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B",
    name: "Rivian Automotive",
  },
  RKLB: {
    address: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2",
    name: "Rocket Lab Corporation",
  },
  RUN: {
    address: "0x756Bc80af765C82da966a788858d65aDF14f3793",
    name: "Sunrun",
  },
  SATS: {
    address: "0x95052ddcd5DC25641657424A8Cf04834997E1730",
    name: "EchoStar",
  },
  SHOP: {
    address: "0xF53F66751B1Eff985311b693531E3290F600c410",
    name: "Shopify",
  },
  SIMO: {
    address: "0x77E655E37F4d913fB9540e0d541D824171a60e81",
    name: "Silicon Motion",
  },
  SKHY: {
    address: "0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8",
    name: "SK hynix Inc. American Depositary Shares",
  },
  SLS: {
    address: "0x285b231728c7E4333799183DF1094d775246a535",
    name: "SELLAS Life Sciences",
  },
  SMCI: {
    address: "0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a",
    name: "Super Micro Computer",
  },
  SMR: {
    address: "0x1Eebee7F74517e0279dFb09d25B0407bEEc3FDd6",
    name: "NuScale Power",
  },
  SNAP: { address: "0xF6589F11Bc40b669e584073F428B05562F568733", name: "Snap" },
  SNDK: {
    address: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400",
    name: "Sandisk Corporation",
  },
  SNOW: {
    address: "0xBa0CAB75495255d0cB58E22B648bFED4ECD1F47E",
    name: "Snowflake",
  },
  SOFI: {
    address: "0x98E75885157C80992A8D41b696D8c9C6Fb30A926",
    name: "SoFi Technologies",
  },
  SOUN: {
    address: "0x6E3Dfd9f7e1649BaA14D25cac18C94d62dB10A54",
    name: "SoundHound AI",
  },
  SPCX: {
    address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
    name: "Space Exploration Technologies Corp. Class A Common Stock",
  },
  TE: {
    address: "0xb1969f6604CA1AE7a2cD3F1827876e914594CA2D",
    name: "T1 Energy",
  },
  TEAM: {
    address: "0x5B97476b922F3305131B8f0B9D333172E87f4aaE",
    name: "Atlassian Corporation",
  },
  TEM: {
    address: "0xB1CC0EC7Db69Cf43539119814df40071b9d61793",
    name: "Tempus AI",
  },
  TER: {
    address: "0x2778C5024D5cA2CdB0f8eAD671ffc69963AdCD9C",
    name: "Teradyne",
  },
  TSEM: {
    address: "0x89776d4Cd68193597A2fC132cfaC1fDe36CCeA8a",
    name: "Tower Semiconductor",
  },
  TSLA: {
    address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    name: "Tesla",
  },
  TSM: {
    address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA",
    name: "Taiwan Semiconductor Manufacturing",
  },
  TTD: {
    address: "0x0b5fb4031cae9163db10B169Ee72685F0EdC8545",
    name: "Trade Desk",
  },
  TTWO: {
    address: "0x5e81213613b6B86EaB4c6c50d718d34359459786",
    name: "Take-Two Interactive Software",
  },
  UMC: {
    address: "0x0E6e67Ba88e7b5d9B67636A215c76779B948dE79",
    name: "United Microelectronics",
  },
  UNH: {
    address: "0xcF364ea52787e289De6F32077834056E3E70D6A8",
    name: "UnitedHealth",
  },
  UPS: { address: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2", name: "UPS" },
  USAR: {
    address: "0xd917B029C761D264c6A312BBbcDA868658eF86a6",
    name: "USA Rare Earth",
  },
  VICR: {
    address: "0x6006ed4B2F94110851ff7509D97D034f0EeD9226",
    name: "Vicor",
  },
  VRT: {
    address: "0xFA78C12E6488814A0262E4e802749a4a737d5fB7",
    name: "Vertiv",
  },
  VSAT: {
    address: "0x26dCbfb34FC83CAbD6990f449674efDc6097fF85",
    name: "ViaSat",
  },
  VST: {
    address: "0x561e2a49212b7cCF47f2744Ccb83e200722fADBc",
    name: "Vistra",
  },
  WDAY: {
    address: "0x82DA4646242e1D962e96e932269Dc644c94a9CaA",
    name: "Workday",
  },
  WDC: {
    address: "0xF52597345A8Edf418bc4071b4a35112472277D3e",
    name: "Western Digital",
  },
  WULF: {
    address: "0x348Be1A8663f15edDe5CDf8A96BB69078f7aB6Fd",
    name: "TeraWulf",
  },
  WYFI: {
    address: "0x9e7ABD3C9139D14E4c86DcE0e455AAB7A0C2FB3E",
    name: "WhiteFiber, Inc.",
  },
  XNDU: {
    address: "0xA8eB3BCcbf2017eE7CBfb652eB51CF2E1B153289",
    name: "Xanadu Quantum",
  },
  XOM: {
    address: "0xf9B46d3D1B22199D4D1025a9cEDB540A33F1a2d5",
    name: "ExxonMobil Holdings Corporation",
  },
  ZM: { address: "0x44c4F142009036cF477eD2d09932051843137CF1", name: "Zoom" },
  ZS: {
    address: "0x7dc013eB55e436f30d7ED1AFE4E36d6e45e3c3f7",
    name: "Zscaler",
  },
};

/**
 * Tokenized ETFs. 17 entries.
 *
 * Canonical, but the method excludes tokenized ETFs categorically, so these
 * are kept apart from STOCK_TOKENS rather than merged in. They are still
 * recognised as real tokens — the point is that the desk must not take
 * inventory in them, not that they are impostors.
 */
export const ETF_TOKENS: Record<string, TokenEntry> = {
  BND: {
    address: "0x2F62fC9fAbb470C690f141c28340eD832bB27020",
    name: "Vanguard Total Bond Market ETF",
  },
  EWT: {
    address: "0x1c690498150252222C275A5CEd69d3A6b1f52D5E",
    name: "iShares MSCI Taiwan Capped ETF",
  },
  EWY: {
    address: "0x7f0aBeF0C07280F82c6a08ead09dEd6BAE2C13Fc",
    name: "iShares MSCI South Korea fund",
  },
  GLD: {
    address: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e",
    name: "SPDR Gold Trust",
  },
  INDA: {
    address: "0xACEF2e09adb47aD6aBeBAD9fF06689E60615C2B6",
    name: "iShares MSCI India ETF",
  },
  QQQ: {
    address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
    name: "Invesco QQQ",
  },
  SCHD: {
    address: "0xd63ABB2C13d7a8421a8017a712802053568e3C1D",
    name: "Schwab US Dividend Equity ETF",
  },
  SGOV: {
    address: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5",
    name: "iShares 0-3 Month Treasury Bond",
  },
  SHY: {
    address: "0xBE274710Bf3d9567e1B290eF6a5F9f90ca016FD8",
    name: "iShares 1-3 Year Treasury Bond ETF",
  },
  SLV: {
    address: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f",
    name: "iShares Silver Trust",
  },
  SMH: {
    address: "0x072f979c2CAc8e1391B0162a87Fee094bF8744a0",
    name: "VanEck Semiconductor ETF",
  },
  SOXX: {
    address: "0x75742c18BC1f1C5c5f448f4C9D9C6F66dafAAa38",
    name: "iShares Semiconductor ETF",
  },
  SPMO: {
    address: "0xAd622320e520de39e72d41EF07438C3Fd3354875",
    name: "Invesco S&P 500 Momentum ETF",
  },
  SPY: {
    address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
    name: "SPDR S&P 500 ETF Trust",
  },
  USO: {
    address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344",
    name: "United States Oil Fund",
  },
  VTI: {
    address: "0x0594134DF3f171a354D9C85eBD65b7A6148F6D09",
    name: "Vanguard Morningstar Total Stock Market ETF",
  },
  XLK: {
    address: "0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43",
    name: "State Street Technology Select Sector SPDR ETF",
  },
};

/** Every canonical token, tradable or not. */
export const ALL_TOKENS: Record<string, TokenEntry> = {
  ...STOCK_TOKENS,
  ...ETF_TOKENS,
};
