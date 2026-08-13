// ============================================================
// bist-symbol-registry.cjs — BIST sembol sicili (ALLOWLIST)
// ============================================================
// NEDEN VAR: sembol tespiti kara listeyle yapılıyordu
// (TICKER_FALSE_POSITIVES). Türkçede büyük harfli kelime kümesi SINIRSIZ
// olduğu için kara liste yapısal olarak yetersiz.
//
// ÖLÇÜLEN CANLI HATA (13 Ağustos 2026):
//   "BRSAN'ın son dönemini GEÇEN YILIN AYNI DÖNEMİYLE karşılaştır"
//   → extractBistTickers → ['BRSAN', 'YILIN', 'AYNI']
//   → "coklu sirket (3)" → skor 4/4 → araştırma sözleşmesi ZORUNLU
//   → ilk araç çağrısı bekletildi, plan kuruldu, aynı araç tekrar çağrıldı
//   → tek şirketlik basit bir YoY sorusu 81 saniye sürdü.
// Kullanıcı üç şirket sormadı; dedektör Türkçe kelimeleri hisse sandı.
//
// TASARIM: allowlist OTORİTEDİR. Sicilde olmayan büyük harfli dizi sembol
// SAYILMAZ. Sonuç olarak yeni halka arz edilmiş bir şirket, sicil
// tazelenene kadar görülmez — bu BİLİNÇLİ bir tercih: eksik tetikleme,
// her Türkçe cümlede sahte şirket saymaktan iyidir. Başarısızlık yönü
// güvenli tarafta.
//
// TAZELEME: scripts/refresh-bist-symbol-registry.cjs
// Kaynak: Mynet canlı borsa panosu, 624 sembol, 2026-08-13.

const BIST_SYMBOLS = Object.freeze(new Set([
  "AAGYO", "ACSEL", "ADEL", "ADESE", "ADGYO", "AEFES", "AFYON", "AGESA",
  "AGHOL", "AGROT", "AGYO", "AHGAZ", "AHSGY", "AKBNK", "AKCNS", "AKENR",
  "AKFGY", "AKFIS", "AKFYE", "AKGRT", "AKHAN", "AKMGY", "AKSA", "AKSEN",
  "AKSGY", "AKSUE", "AKYHO", "ALARK", "ALBRK", "ALBTN", "ALCAR", "ALCTL",
  "ALFAS", "ALGYO", "ALKA", "ALKIM", "ALKLC", "ALTNY", "ALVES", "ANELE",
  "ANGEN", "ANHYT", "ANSGR", "ARASE", "ARCLK", "ARDYZ", "ARENA", "ARFYE",
  "ARMGD", "ARSAN", "ARTMS", "ARZUM", "ASELS", "ASGYO", "ASTOR", "ASUZU",
  "ATAGY", "ATAKP", "ATATP", "ATATR", "ATEKS", "ATLAS", "ATSYH", "AVGYO",
  "AVHOL", "AVOD", "AVPGY", "AVTUR", "AYCES", "AYDEM", "AYEN", "AYES",
  "AYGAZ", "AZTEK", "BAGFS", "BAHKM", "BAKAB", "BALAT", "BALSU", "BANVT",
  "BARMA", "BASCM", "BASGZ", "BAYRK", "BEGYO", "BERA", "BESLR", "BESTE",
  "BETAE", "BEYAZ", "BFREN", "BIENY", "BIGCH", "BIGEN", "BIGTK", "BIMAS",
  "BINBN", "BINHO", "BIOEN", "BIZIM", "BJKAS", "BLCYT", "BLUME", "BMSCH",
  "BMSTL", "BNTAS", "BOBET", "BORLS", "BORSK", "BOSSA", "BRISA", "BRKO",
  "BRKSN", "BRKVY", "BRLSM", "BRMEN", "BRSAN", "BRYAT", "BSOKE", "BTCIM",
  "BUCIM", "BULGS", "BURCE", "BURVA", "BVSAN", "BYDNR", "CANTE", "CASA",
  "CATES", "CCOLA", "CELHA", "CEMAS", "CEMTS", "CEMZY", "CEOEM", "CGCAM",
  "CIMSA", "CLEBI", "CMBTN", "CMENT", "CONSE", "COSMO", "CRDFA", "CRFSA",
  "CUSAN", "CVKMD", "CVKMDR", "CWENE", "DAGI", "DAPGM", "DARDL", "DCTTR",
  "DENGE", "DERHL", "DERIM", "DESA", "DESPC", "DEVA", "DGATE", "DGGYO",
  "DGNMO", "DIRIT", "DITAS", "DMLKTG", "DMRGD", "DMSAS", "DNISI", "DOAS",
  "DOCO", "DOFER", "DOFRB", "DOGUB", "DOHOL", "DOKTA", "DSTKF", "DUNYH",
  "DURDO", "DURKN", "DYOBY", "DZGYO", "EBEBK", "ECILC", "ECOGR", "ECZYT",
  "EDATA", "EDIP", "EFOR", "EGEEN", "EGEGY", "EGEPO", "EGGUB", "EGPRO",
  "EGSER", "EKDMR", "EKGYO", "EKIM", "EKIZ", "EKOS", "EKSUN", "ELITE",
  "EMKEL", "EMNIS", "EMPAE", "ENDAE", "ENERY", "ENJSA", "ENKAI", "ENPRA",
  "ENSRI", "ENTRA", "EPLAS", "ERBOS", "ERCB", "EREGL", "ERSU", "ESCAR",
  "ESCOM", "ESEN", "ETILR", "ETYAT", "EUHOL", "EUKYO", "EUPWR", "EUREN",
  "EUYO", "EYGYO", "FADE", "FENER", "FLAP", "FMIZP", "FONET", "FORMT",
  "FORTE", "FRIGO", "FRMPL", "FROTO", "FZLGY", "GARAN", "GARFA", "GATEG",
  "GEDIK", "GEDZA", "GENIL", "GENKM", "GENTS", "GEREL", "GESAN", "GIPTA",
  "GLBMD", "GLCVY", "GLRMK", "GLRYH", "GLYHO", "GMTAS", "GOKNR", "GOLDA",
  "GOLTS", "GOODY", "GOZDE", "GRNYO", "GRSEL", "GRTHO", "GSDDE", "GSDHO",
  "GSRAY", "GUBRF", "GUNDG", "GWIND", "GZNMI", "HALKB", "HATEK", "HATSN",
  "HDFGS", "HEDEF", "HEKTS", "HKTM", "HLGYO", "HOROZ", "HRKET", "HTTBT",
  "HUBVC", "HUNER", "HURGZ", "ICBCT", "ICUGS", "IDGYO", "IEYHO", "IHAAS",
  "IHEVA", "IHGZT", "IHLAS", "IHLGM", "IHYAY", "IMASM", "INDES", "INFO",
  "INGRM", "INTEK", "INTEM", "INVEO", "INVES", "ISATR", "ISBIR", "ISBTR",
  "ISCTR", "ISDMR", "ISFIN", "ISGSY", "ISGYO", "ISKPL", "ISKUR", "ISMEN",
  "ISSEN", "ISVEA", "ISYAT", "IZENR", "IZFAS", "IZINV", "IZMDC", "JANTS",
  "KAPLM", "KARCL", "KAREL", "KARSN", "KARTN", "KATMR", "KAYSE", "KBORU",
  "KCAER", "KCHOL", "KENT", "KERVN", "KFEIN", "KGYO", "KIMMR", "KLGYO",
  "KLKIM", "KLMSN", "KLNMA", "KLRHO", "KLSER", "KLSYN", "KLYPV", "KMPUR",
  "KNFRT", "KOCMT", "KONKA", "KONTR", "KONYA", "KOPOL", "KORDS", "KOTON",
  "KRDMA", "KRDMB", "KRDMD", "KRGYO", "KRONT", "KRPLS", "KRSTL", "KRTEK",
  "KRVGD", "KSTUR", "KTLEV", "KTSKR", "KUTPO", "KUVVA", "KUYAS", "KZBGY",
  "KZGYO", "LIDER", "LIDFA", "LILAK", "LINK", "LKMNH", "LMKDC", "LOGO",
  "LRSHO", "LUKSK", "LXGYO", "LYDHO", "LYDYE", "MAALT", "MACKO", "MAGEN",
  "MAKIM", "MAKTK", "MANAS", "MARBL", "MARKA", "MARMR", "MARTI", "MASFN",
  "MAVI", "MCARD", "MEDTR", "MEGAP", "MEGMT", "MEKAG", "MEPET", "MERCN",
  "MERIT", "MERKO", "METEN", "METRO", "MEYSU", "MGROS", "MHRGY", "MIATK",
  "MMCAS", "MNDRS", "MNDTR", "MOBTL", "MOGAN", "MOPAS", "MPARK", "MRGYO",
  "MRSHL", "MSGYO", "MTRKS", "MTRYO", "MZHLD", "NATEN", "NETAS", "NETCD",
  "NIBAS", "NTGAZ", "NTHOL", "NUGYO", "NUHCM", "OBAMS", "OBASE", "ODAS",
  "ODINE", "OFSYM", "ONCSM", "ONRYT", "ORCAY", "ORGE", "ORMA", "ORZAX",
  "OSMEN", "OSTIM", "OTKAR", "OTTO", "OYAKC", "OYAYO", "OYLUM", "OYYAT",
  "OZATD", "OZGYO", "OZKGY", "OZRDN", "OZSUB", "OZYSR", "PAGYO", "PAHOL",
  "PAMEL", "PAPIL", "PARSN", "PASEU", "PATEK", "PCILT", "PEKGY", "PENGD",
  "PENTA", "PETKM", "PETUN", "PGSUS", "PINSU", "PKART", "PKENT", "PLTUR",
  "PNLSN", "PNSUT", "POLHO", "POLTK", "PRDGS", "PRKAB", "PRKME", "PRZMA",
  "PSDTC", "PSGYO", "QNBFK", "QNBTR", "QUAGR", "QUICK", "RALYH", "RAYSG",
  "REEDR", "RGYAS", "RNPOL", "RODRG", "RTALB", "RUBNS", "RUZYE", "RYGYO",
  "RYSAS", "SAFKR", "SAHOL", "SAMAT", "SANEL", "SANFM", "SANKO", "SARAE",
  "SARKY", "SASA", "SAYAS", "SDTTR", "SEGMN", "SEGYO", "SEKFK", "SEKUR",
  "SELEC", "SELVA", "SERNT", "SEYKM", "SILVR", "SISE", "SKBNK", "SKTAS",
  "SKYLP", "SKYMD", "SMART", "SMRTG", "SMRVA", "SNGYO", "SNICA", "SNPAM",
  "SODSN", "SOHOE", "SOKE", "SOKM", "SONME", "SRVGY", "SSAAT", "SUMAS",
  "SUNTK", "SURGY", "SUWEN", "SVGYO", "TABGD", "TARKM", "TATEN", "TATGD",
  "TAVHL", "TBORG", "TCELL", "TCKRC", "TDGYO", "TEHOL", "TEKTU", "TERA",
  "TEZOL", "TGSAS", "THYAO", "TKFEN", "TKNSA", "TLMAN", "TMPOL", "TMSN",
  "TNZTP", "TOASO", "TRALT", "TRCAS", "TRENJ", "TRGYO", "TRHOL", "TRILC",
  "TRMET", "TSGYO", "TSKB", "TSPOR", "TTKOM", "TTRAK", "TUCLK", "TUKAS",
  "TUPRS", "TUREX", "TURGG", "TURSG", "UCAYM", "UFUK", "ULAS", "ULKER",
  "ULUFA", "ULUSE", "ULUUN", "UMPAS", "UNLU", "USAK", "VAKBN", "VAKFA",
  "VAKFN", "VAKKO", "VANGD", "VBTYZ", "VERTU", "VERUS", "VESBE", "VESTL",
  "VKFYO", "VKGYO", "VKING", "VRGYO", "VSNMD", "YAPRK", "YATAS", "YAYLA",
  "YBTAS", "YEOTK", "YESIL", "YGGYO", "YIGIT", "YKBNK", "YKSLN", "YONGA",
  "YUNSA", "YYAPI", "YYLGD", "ZEDUR", "ZERGY", "ZGYO", "ZOREN", "ZRGYO",
]));

/** Sicilde kayıtlı mı? Sembol büyük harfe çevrilir, .IS soneki atılır. */
function isKnownBistSymbol(token) {
  const s = String(token || '').trim().toUpperCase().replace(/.IS$/i, '');
  return BIST_SYMBOLS.has(s);
}

module.exports = { BIST_SYMBOLS, isKnownBistSymbol, REGISTRY_SIZE: BIST_SYMBOLS.size, REGISTRY_SOURCE: 'mynet_canli_borsa', REGISTRY_DATE: '2026-08-13' };
