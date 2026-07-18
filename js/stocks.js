/**
 * stocks.js — KSE-100 constituents with metadata for StockSage AI.
 * Symbols use the Yahoo Finance .KA suffix (.KAR was deprecated).
 * Data sourced from PSX official KSE-100 index composition (periodically updated).
 * Each entry: { symbol, name, sector, marketCap (PKR billions, approx), peRatio (approx) }
 */
const KSE100_STOCKS = [
  // ---- Oil & Gas Exploration ----
  { symbol: "OGDC.KA", name: "Oil & Gas Development Co.", sector: "Oil & Gas Exploration", marketCap: 565, peRatio: 3.2 },
  { symbol: "PPL.KA", name: "Pakistan Petroleum Ltd.", sector: "Oil & Gas Exploration", marketCap: 315, peRatio: 2.8 },
  { symbol: "POL.KA", name: "Pakistan Oilfields Ltd.", sector: "Oil & Gas Exploration", marketCap: 150, peRatio: 3.5 },
  { symbol: "MARI.KA", name: "Mari Petroleum Co.", sector: "Oil & Gas Exploration", marketCap: 350, peRatio: 6.2 },

  // ---- Oil & Gas Marketing ----
  { symbol: "PSO.KA", name: "Pakistan State Oil", sector: "Oil & Gas Marketing", marketCap: 65, peRatio: 4.8 },
  { symbol: "SHEL.KA", name: "Shell Pakistan", sector: "Oil & Gas Marketing", marketCap: 35, peRatio: 6.1 },
  { symbol: "APL.KA", name: "Attock Petroleum Ltd.", sector: "Oil & Gas Marketing", marketCap: 50, peRatio: 4.2 },
  { symbol: "HASCOL.KA", name: "Hascol Petroleum", sector: "Oil & Gas Marketing", marketCap: 8, peRatio: null },

  // ---- Refinery ----
  { symbol: "ATRL.KA", name: "Attock Refinery Ltd.", sector: "Refinery", marketCap: 55, peRatio: 1.8 },
  { symbol: "NRL.KA", name: "National Refinery Ltd.", sector: "Refinery", marketCap: 25, peRatio: 2.5 },
  { symbol: "PRL.KA", name: "Pakistan Refinery Ltd.", sector: "Refinery", marketCap: 18, peRatio: null },

  // ---- Power Generation & Distribution ----
  { symbol: "HUBC.KA", name: "Hub Power Company", sector: "Power Generation", marketCap: 200, peRatio: 3.0 },
  { symbol: "KAPCO.KA", name: "Kot Addu Power Co.", sector: "Power Generation", marketCap: 55, peRatio: 4.5 },
  { symbol: "LPL.KA", name: "Lalpir Power Ltd.", sector: "Power Generation", marketCap: 12, peRatio: 2.8 },
  { symbol: "NCPL.KA", name: "Nishat Chunian Power", sector: "Power Generation", marketCap: 10, peRatio: 3.2 },
  { symbol: "NPL.KA", name: "Nishat Power Ltd.", sector: "Power Generation", marketCap: 15, peRatio: 3.5 },
  { symbol: "SPWL.KA", name: "Saif Power Ltd.", sector: "Power Generation", marketCap: 8, peRatio: 4.0 },
  { symbol: "EPQL.KA", name: "Engro Powergen Qadirpur", sector: "Power Generation", marketCap: 25, peRatio: 3.8 },

  // ---- Cement ----
  { symbol: "LUCK.KA", name: "Lucky Cement Ltd.", sector: "Cement", marketCap: 270, peRatio: 6.5 },
  { symbol: "DGKC.KA", name: "D.G. Khan Cement", sector: "Cement", marketCap: 55, peRatio: 8.2 },
  { symbol: "MLCF.KA", name: "Maple Leaf Cement", sector: "Cement", marketCap: 52, peRatio: 7.8 },
  { symbol: "FCCL.KA", name: "Fauji Cement Co.", sector: "Cement", marketCap: 60, peRatio: 6.9 },
  { symbol: "CHCC.KA", name: "Cherat Cement Co.", sector: "Cement", marketCap: 38, peRatio: 5.8 },
  { symbol: "PIOC.KA", name: "Pioneer Cement Ltd.", sector: "Cement", marketCap: 30, peRatio: 7.5 },
  { symbol: "BWCL.KA", name: "Bestway Cement Ltd.", sector: "Cement", marketCap: 45, peRatio: 8.8 },
  { symbol: "KOHC.KA", name: "Kohat Cement Co.", sector: "Cement", marketCap: 28, peRatio: 6.2 },
  { symbol: "GWLC.KA", name: "Gharibwal Cement Ltd.", sector: "Cement", marketCap: 14, peRatio: 9.1 },
  { symbol: "THCCL.KA", name: "Thatta Cement Co.", sector: "Cement", marketCap: 8, peRatio: 12.5 },

  // ---- Fertilizer ----
  { symbol: "ENGRO.KA", name: "Engro Corporation Ltd.", sector: "Fertilizer", marketCap: 190, peRatio: 5.2 },
  { symbol: "FFC.KA", name: "Fauji Fertilizer Co.", sector: "Fertilizer", marketCap: 240, peRatio: 4.8 },
  { symbol: "FFBL.KA", name: "Fauji Fertilizer Bin Qasim", sector: "Fertilizer", marketCap: 60, peRatio: 6.5 },
  { symbol: "FATIMA.KA", name: "Fatima Fertilizer Co.", sector: "Fertilizer", marketCap: 85, peRatio: 5.1 },
  { symbol: "EFERT.KA", name: "Engro Fertilizers Ltd.", sector: "Fertilizer", marketCap: 210, peRatio: 5.5 },

  // ---- Chemicals ----
  { symbol: "COLG.KA", name: "Colgate-Palmolive Pakistan", sector: "Chemicals", marketCap: 85, peRatio: 18.5 },
  { symbol: "ICI.KA", name: "ICI Pakistan", sector: "Chemicals", marketCap: 80, peRatio: 12.2 },
  { symbol: "LOTCHEM.KA", name: "Lotte Chemical Pakistan", sector: "Chemicals", marketCap: 55, peRatio: 7.8 },
  { symbol: "EPCL.KA", name: "Engro Polymer & Chemicals", sector: "Chemicals", marketCap: 42, peRatio: 6.5 },
  { symbol: "AGL.KA", name: "Agritech Ltd.", sector: "Chemicals", marketCap: 15, peRatio: null },
  { symbol: "SITC.KA", name: "Sitara Chemical Ind.", sector: "Chemicals", marketCap: 14, peRatio: 8.1 },
  { symbol: "BAPL.KA", name: "Bawany Air Products", sector: "Chemicals", marketCap: 5, peRatio: null },

  // ---- Commercial Banks ----
  { symbol: "MCB.KA", name: "MCB Bank Ltd.", sector: "Commercial Banks", marketCap: 320, peRatio: 5.5 },
  { symbol: "UBL.KA", name: "United Bank Ltd.", sector: "Commercial Banks", marketCap: 280, peRatio: 5.1 },
  { symbol: "HBL.KA", name: "Habib Bank Ltd.", sector: "Commercial Banks", marketCap: 240, peRatio: 4.8 },
  { symbol: "BAFL.KA", name: "Bank Alfalah Ltd.", sector: "Commercial Banks", marketCap: 105, peRatio: 4.5 },
  { symbol: "BAHL.KA", name: "Bank Al-Habib Ltd.", sector: "Commercial Banks", marketCap: 150, peRatio: 5.2 },
  { symbol: "ABL.KA", name: "Allied Bank Ltd.", sector: "Commercial Banks", marketCap: 130, peRatio: 4.3 },
  { symbol: "HMB.KA", name: "Habib Metropolitan Bank", sector: "Commercial Banks", marketCap: 55, peRatio: 3.9 },
  { symbol: "NBP.KA", name: "National Bank of Pakistan", sector: "Commercial Banks", marketCap: 90, peRatio: 5.0 },
  { symbol: "BOP.KA", name: "Bank of Punjab", sector: "Commercial Banks", marketCap: 55, peRatio: 4.2 },
  { symbol: "AKBL.KA", name: "Askari Bank Ltd.", sector: "Commercial Banks", marketCap: 30, peRatio: 5.8 },
  { symbol: "FABL.KA", name: "Faysal Bank Ltd.", sector: "Commercial Banks", marketCap: 45, peRatio: 4.8 },
  { symbol: "MEBL.KA", name: "Meezan Bank Ltd.", sector: "Commercial Banks", marketCap: 350, peRatio: 8.5 },
  { symbol: "SNBL.KA", name: "Soneri Bank Ltd.", sector: "Commercial Banks", marketCap: 20, peRatio: 5.1 },
  { symbol: "JSBL.KA", name: "JS Bank Ltd.", sector: "Commercial Banks", marketCap: 22, peRatio: 6.5 },

  // ---- Textile ----
  { symbol: "NML.KA", name: "Nishat Mills Ltd.", sector: "Textile", marketCap: 60, peRatio: 5.2 },
  { symbol: "NCL.KA", name: "Nishat Chunian Ltd.", sector: "Textile", marketCap: 12, peRatio: 5.8 },
  { symbol: "GATM.KA", name: "Gul Ahmed Textile Mills", sector: "Textile", marketCap: 35, peRatio: 4.8 },
  { symbol: "KTML.KA", name: "Kohinoor Textile Mills", sector: "Textile", marketCap: 15, peRatio: 4.5 },
  { symbol: "ILP.KA", name: "Interloop Ltd.", sector: "Textile", marketCap: 55, peRatio: 7.2 },
  { symbol: "FML.KA", name: "Feroze 1888 Mills Ltd.", sector: "Textile", marketCap: 8, peRatio: null },

  // ---- Automobile ----
  { symbol: "INDU.KA", name: "Indus Motor Co.", sector: "Automobile", marketCap: 90, peRatio: 9.5 },
  { symbol: "PSMC.KA", name: "Pak Suzuki Motor Co.", sector: "Automobile", marketCap: 28, peRatio: 18.5 },
  { symbol: "HCAR.KA", name: "Honda Atlas Cars Pakistan", sector: "Automobile", marketCap: 42, peRatio: 12.1 },
  { symbol: "ATLH.KA", name: "Atlas Honda Ltd.", sector: "Automobile", marketCap: 55, peRatio: 10.5 },
  { symbol: "GHNI.KA", name: "Ghandhara Industries", sector: "Automobile", marketCap: 20, peRatio: 8.2 },
  { symbol: "GHNL.KA", name: "Ghandhara Nissan", sector: "Automobile", marketCap: 18, peRatio: 9.1 },
  { symbol: "SAZEW.KA", name: "Sazgar Engineering Works", sector: "Automobile", marketCap: 35, peRatio: 8.8 },
  { symbol: "AGIL.KA", name: "Agriauto Industries", sector: "Automobile", marketCap: 8, peRatio: 7.5 },

  // ---- Pharmaceutical ----
  { symbol: "SEARL.KA", name: "Searle Company Ltd.", sector: "Pharmaceutical", marketCap: 55, peRatio: 12.2 },
  { symbol: "GLAXO.KA", name: "GlaxoSmithKline Pakistan", sector: "Pharmaceutical", marketCap: 45, peRatio: 15.8 },
  { symbol: "ABOT.KA", name: "Abbott Laboratories Pak.", sector: "Pharmaceutical", marketCap: 58, peRatio: 14.5 },
  { symbol: "FEROZ.KA", name: "Ferozsons Laboratories", sector: "Pharmaceutical", marketCap: 25, peRatio: 10.2 },
  { symbol: "HINOON.KA", name: "Highnoon Laboratories", sector: "Pharmaceutical", marketCap: 18, peRatio: 8.5 },
  { symbol: "OTSUKA.KA", name: "Otsuka Pakistan", sector: "Pharmaceutical", marketCap: 14, peRatio: 11.2 },
  { symbol: "AGP.KA", name: "AGP Ltd.", sector: "Pharmaceutical", marketCap: 25, peRatio: 9.8 },

  // ---- Technology ----
  { symbol: "SYS.KA", name: "Systems Ltd.", sector: "Technology", marketCap: 140, peRatio: 22.5 },
  { symbol: "AVN.KA", name: "Avanceon Ltd.", sector: "Technology", marketCap: 20, peRatio: 18.2 },
  { symbol: "NETSOL.KA", name: "NetSol Technologies", sector: "Technology", marketCap: 18, peRatio: 15.5 },
  { symbol: "TRG.KA", name: "TRG Pakistan", sector: "Technology", marketCap: 40, peRatio: 28.8 },
  { symbol: "PTC.KA", name: "Pakistan Telecommunication Co.", sector: "Technology", marketCap: 80, peRatio: 9.5 },
  { symbol: "OCTOPUS.KA", name: "Octopus Digital", sector: "Technology", marketCap: 15, peRatio: 12.1 },
  { symbol: "AIRLINK.KA", name: "Air Link Communication", sector: "Technology", marketCap: 25, peRatio: 11.5 },

  // ---- Food & Personal Care ----
  { symbol: "NESTLE.KA", name: "Nestlé Pakistan", sector: "Food & Beverages", marketCap: 380, peRatio: 32.5 },
  { symbol: "UPFL.KA", name: "Unilever Pakistan Foods", sector: "Food & Beverages", marketCap: 110, peRatio: 45.2 },
  { symbol: "MFFL.KA", name: "Mitchell's Fruit Farms", sector: "Food & Beverages", marketCap: 12, peRatio: 18.5 },
  { symbol: "MUREB.KA", name: "Murree Brewery Co.", sector: "Food & Beverages", marketCap: 25, peRatio: 15.2 },
  { symbol: "QUICE.KA", name: "Quice Food Industries", sector: "Food & Beverages", marketCap: 5, peRatio: null },
  { symbol: "NATF.KA", name: "National Foods Ltd.", sector: "Food & Beverages", marketCap: 35, peRatio: 16.8 },
  { symbol: "RMPL.KA", name: "Rafhan Maize Products", sector: "Food & Beverages", marketCap: 55, peRatio: 28.2 },
  { symbol: "CLOV.KA", name: "Clover Pakistan", sector: "Food & Beverages", marketCap: 8, peRatio: null },
  { symbol: "BATA.KA", name: "Bata Pakistan", sector: "Personal Care & Leather", marketCap: 15, peRatio: 12.5 },
  { symbol: "ULEVER.KA", name: "Unilever Pakistan", sector: "Personal Care & Leather", marketCap: 220, peRatio: 42.0 },
  { symbol: "TREET.KA", name: "Treet Corporation", sector: "Personal Care & Leather", marketCap: 20, peRatio: 8.5 },

  // ---- Engineering & Industrial ----
  { symbol: "ISL.KA", name: "International Steels Ltd.", sector: "Engineering", marketCap: 35, peRatio: 6.5 },
  { symbol: "ASL.KA", name: "Aisha Steel Mills", sector: "Engineering", marketCap: 12, peRatio: 5.2 },
  { symbol: "ASTL.KA", name: "Amreli Steels Ltd.", sector: "Engineering", marketCap: 10, peRatio: 8.1 },
  { symbol: "MUGHAL.KA", name: "Mughal Iron & Steel", sector: "Engineering", marketCap: 22, peRatio: 5.8 },
  { symbol: "HUMNL.KA", name: "Hum Network Ltd.", sector: "Media & Entertainment", marketCap: 12, peRatio: 7.5 },

  // ---- Insurance ----
  { symbol: "EFUG.KA", name: "EFU General Insurance", sector: "Insurance", marketCap: 20, peRatio: 8.2 },
  { symbol: "EFUL.KA", name: "EFU Life Assurance", sector: "Insurance", marketCap: 25, peRatio: 9.5 },
  { symbol: "JGICL.KA", name: "Jubilee General Insurance", sector: "Insurance", marketCap: 15, peRatio: 7.8 },
  { symbol: "PAKRI.KA", name: "Pakistan Reinsurance", sector: "Insurance", marketCap: 12, peRatio: 8.5 },
  { symbol: "AGIC.KA", name: "Askari General Insurance", sector: "Insurance", marketCap: 8, peRatio: 9.1 },

  // ---- Miscellaneous ----
  { symbol: "PIBTL.KA", name: "Pakistan Intl. Bulk Terminal", sector: "Transport", marketCap: 18, peRatio: 6.5 },
  { symbol: "PNSC.KA", name: "Pakistan National Shipping", sector: "Transport", marketCap: 15, peRatio: 5.2 },
  { symbol: "PIAA.KA", name: "PIA Holding Co.", sector: "Transport", marketCap: 12, peRatio: null },
  { symbol: "DCL.KA", name: "Dolmen City REIT", sector: "Real Estate", marketCap: 35, peRatio: 8.5 },
  { symbol: "JVDC.KA", name: "Javedan Corporation", sector: "Real Estate", marketCap: 12, peRatio: 12.2 },
  { symbol: "TPLP.KA", name: "TPL Properties", sector: "Real Estate", marketCap: 15, peRatio: 11.0 },
  { symbol: "GRYL.KA", name: "Grays Leasing", sector: "Leasing", marketCap: 5, peRatio: null },
  { symbol: "SPLC.KA", name: "Saudi Pak Leasing", sector: "Leasing", marketCap: 5, peRatio: null },
];

// Map for quick lookup
const STOCK_MAP = Object.fromEntries(KSE100_STOCKS.map(s => [s.symbol, s]));

// Get all unique sectors
const SECTORS_UNIQUE = [...new Set(KSE100_STOCKS.map(s => s.sector))].sort();