// ─────────────────────────────────────────────────────────────────────────────
// PDF.js worker (CDN)
// ─────────────────────────────────────────────────────────────────────────────
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ─────────────────────────────────────────────────────────────────────────────
// Marker dictionary — canonical name → aliases (sorted longest-first at startup)
// ─────────────────────────────────────────────────────────────────────────────
const MARKERS = {
  // CBC
  'Hemoglobin':                              ['HAEMOGLOBIN', 'HEMOGLOBIN', 'HGB', 'HB'],
  'Hematocrit':                              ['HEMATOCRIT (PCV)', 'HEMATOCRIT', 'HAEMATOCRIT', 'PACKED CELL VOLUME', 'HCT', 'PCV'],
  'RBC Count':                               ['TOTAL RBC', 'RBC COUNT', 'RED BLOOD CELL COUNT', 'RBC'],
  'Mean Corpuscular Volume':                 ['MEAN CORPUSCULAR VOLUME (MCV)', 'MEAN CORPUSCULAR VOLUME', 'MCV'],
  'Mean Corpuscular Hemoglobin':             ['MEAN CORPUSCULAR HEMOGLOBIN (MCH)', 'MEAN CORPUSCULAR HAEMOGLOBIN (MCH)', 'MEAN CORPUSCULAR HEMOGLOBIN', 'MEAN CORPUSCULAR HAEMOGLOBIN', 'MCH'],
  'Mean Corpuscular Hemoglobin Concentration': ['MEAN CORP.HEMO. CONC (MCHC)', 'MEAN CORPUSCULAR HEMOGLOBIN CONCENTRATION', 'MEAN CORPUSCULAR HAEMOGLOBIN CONCENTRATION', 'MCHC'],
  'Red Cell Distribution Width-CV':          ['RED CELL DISTRIBUTION WIDTH (RDW - CV)', 'RED CELL DISTRIBUTION WIDTH - CV', 'RDW-CV', 'RDW CV'],
  'Red Cell Distribution Width-SD':          ['RED CELL DISTRIBUTION WIDTH - SD (RDW-SD)', 'RED CELL DISTRIBUTION WIDTH - SD', 'RDW-SD', 'RDW SD'],
  'White Blood Cell Count':                  ['TOTAL LEUCOCYTE COUNT (WBC)', 'TOTAL LEUCOCYTE COUNT', 'TOTAL LEUKOCYTE COUNT', 'WHITE BLOOD CELL COUNT', 'TLC', 'WBC'],
  'Neutrophils %':                           ['NEUTROPHILS PERCENTAGE', 'NEUTROPHILS %', 'NEUTROPHIL PERCENTAGE', 'NEUTROPHILS'],
  'Neutrophils Absolute':                    ['NEUTROPHILS - ABSOLUTE COUNT', 'ABSOLUTE NEUTROPHIL COUNT', 'NEUTROPHILS ABSOLUTE COUNT', 'NEUTROPHIL ABSOLUTE', 'ANC'],
  'Lymphocytes %':                           ['LYMPHOCYTES PERCENTAGE', 'LYMPHOCYTES %', 'LYMPHOCYTE PERCENTAGE', 'LYMPHOCYTES'],
  'Lymphocytes Absolute':                    ['LYMPHOCYTES - ABSOLUTE COUNT', 'ABSOLUTE LYMPHOCYTE COUNT', 'LYMPHOCYTES ABSOLUTE COUNT', 'LYMPHOCYTE ABSOLUTE'],
  'Monocytes %':                             ['MONOCYTES PERCENTAGE', 'MONOCYTES %', 'MONOCYTE PERCENTAGE', 'MONOCYTES'],
  'Monocytes Absolute':                      ['MONOCYTES - ABSOLUTE COUNT', 'ABSOLUTE MONOCYTE COUNT', 'MONOCYTES ABSOLUTE COUNT', 'MONOCYTE ABSOLUTE'],
  'Eosinophils %':                           ['EOSINOPHILS PERCENTAGE', 'EOSINOPHILS %', 'EOSINOPHIL PERCENTAGE', 'EOSINOPHILS'],
  'Eosinophils Absolute':                    ['EOSINOPHILS - ABSOLUTE COUNT', 'ABSOLUTE EOSINOPHIL COUNT', 'EOSINOPHILS ABSOLUTE COUNT', 'EOSINOPHIL ABSOLUTE'],
  'Basophils %':                             ['BASOPHILS PERCENTAGE', 'BASOPHILS %', 'BASOPHIL PERCENTAGE', 'BASOPHILS'],
  'Basophils Absolute':                      ['BASOPHILS - ABSOLUTE COUNT', 'ABSOLUTE BASOPHIL COUNT', 'BASOPHILS ABSOLUTE COUNT', 'BASOPHIL ABSOLUTE'],
  'Platelet Count':                          ['PLATELET COUNT', 'PLATELETS', 'PLT'],
  'Mean Platelet Volume':                    ['MEAN PLATELET VOLUME (MPV)', 'MEAN PLATELET VOLUME', 'MPV'],
  'Platelet Distribution Width':             ['PLATELET DISTRIBUTION WIDTH (PDW)', 'PLATELET DISTRIBUTION WIDTH', 'PDW'],
  'Plateletcrit':                            ['PLATELETCRIT (PCT)', 'PLATELETCRIT', 'PCT'],
  'Platelet Large Cell Ratio':               ['PLATELET TO LARGE CELL RATIO (PLCR)', 'PLATELET TO LARGE CELL RATIO', 'PLCR'],

  // Lipid
  'Total Cholesterol':     ['TOTAL CHOLESTEROL', 'CHOLESTEROL TOTAL', 'CHOLESTEROL, TOTAL', 'CHOLESTEROL - TOTAL', 'CHOLESTEROL'],
  'HDL Cholesterol':       ['HDL CHOLESTEROL - DIRECT', 'HDL CHOLESTEROL', 'HIGH - DENSITY LIPOPROTEIN HDL', 'HIGH - DENSITY LIPOPROTEIN', 'HIGH DENSITY LIPOPROTEIN', 'CHOLESTEROL - HDL', 'HDL'],
  'LDL Cholesterol':       ['LDL CHOLESTEROL - DIRECT', 'LDL CHOLESTEROL', 'LOW - DENSITY LIPOPROTEIN LDL', 'LOW - DENSITY LIPOPROTEIN', 'LOW DENSITY LIPOPROTEIN', 'CHOLESTEROL - LDL', 'LDL'],
  'VLDL Cholesterol':      ['VLDL CHOLESTEROL', 'VERY LOW DENSITY LIPOPROTEIN', 'CHOLESTEROL- VLDL', 'CHOLESTEROL - VLDL', 'VLDL'],
  'Triglycerides':         ['TRIGLYCERIDES', 'TRIGLYCERIDE', 'TG'],

  // LFT
  'AST (Aspartate Aminotransferase)': ['ASPARTATE AMINOTRANSFERASE (SGOT)', 'ASPARTATE AMINOTRANSFERASE(AST/SGOT)', 'ASPARTATE AMINOTRANSFERASE', 'AST/SGOT', 'SGOT', 'AST'],
  'ALT (Alanine Transaminase)':       ['ALANINE TRANSAMINASE (SGPT)', 'ALANINE AMINOTRANSFERASE (ALT/SGPT)', 'ALANINE TRANSAMINASE', 'ALANINE AMINOTRANSFERASE', 'ALT/SGPT', 'SGPT', 'ALT'],
  'AST/ALT Ratio':                    ['SGOT / SGPT RATIO', 'SGOT/SGPT RATIO', 'AST/ALT RATIO', 'AST/ALT'],
  'Alkaline Phosphatase':             ['ALKALINE PHOSPHATASE', 'ALP'],
  'Gamma-Glutamyl Transferase':       ['GAMMA GLUTAMYL TRANSFERASE (GGT)', 'GAMMA GLUTAMYL TRANSFERASE', 'GAMMA GT', 'GGT'],
  'Bilirubin Total':                  ['BILIRUBIN - TOTAL', 'BILIRUBIN TOTAL', 'TOTAL BILIRUBIN', 'BILIRUBIN, TOTAL', 'BILIRUBIN'],
  'Bilirubin Direct':                 ['BILIRUBIN -DIRECT', 'BILIRUBIN DIRECT', 'DIRECT BILIRUBIN', 'BILIRUBIN, DIRECT'],
  'Bilirubin Indirect':               ['BILIRUBIN (INDIRECT)', 'BILIRUBIN INDIRECT', 'INDIRECT BILIRUBIN', 'BILIRUBIN, INDIRECT'],
  'Total Protein':                    ['PROTEIN - TOTAL', 'TOTAL PROTEIN', 'PROTEIN, TOTAL', 'PROTEIN'],
  'Albumin':                          ['ALBUMIN - SERUM', 'SERUM ALBUMIN', 'ALBUMIN'],
  'Globulin':                         ['SERUM GLOBULIN', 'GLOBULIN'],
  'Albumin/Globulin Ratio':           ['SERUM ALB/GLOBULIN RATIO', 'ALBUMIN GLOBULIN RATIO', 'A/G RATIO'],

  // KFT
  'Creatinine':                          ['CREATININE - SERUM', 'SERUM CREATININE', 'CREATININE, SERUM', 'CREATININE'],
  'Blood Urea Nitrogen':                 ['BLOOD UREA NITROGEN (BUN)', 'BLOOD UREA NITROGEN', 'BUN'],
  'Urea':                                ['UREA (CALCULATED)', 'UREA'],
  'Uric Acid':                           ['URIC ACID'],
  'Calcium':                             ['CALCIUM'],
  'Glomerular Filtration Rate (eGFR)':   ['EST. GLOMERULAR FILTRATION RATE (EGFR)', 'EST. GLOMERULAR FILTRATION RATE', 'ESTIMATED GLOMERULAR FILTRATION RATE', 'EGFR'],
  'Blood Urea Nitrogen/Creatinine Ratio':['BLOOD UREA NITROGEN (BUN)/CREATININE RATIO', 'BUN / SR.CREATININE RATIO', 'BUN/SR.CREATININE RATIO', 'BUN/CREATININE RATIO'],
  'Urea/Creatinine Ratio':               ['UREA / SR.CREATININE RATIO', 'UREA/CREATININE RATIO'],

  // Thyroid
  'Thyroid Stimulating Hormone': ['TSH - ULTRASENSITIVE', 'TSH ULTRASENSITIVE', 'THYROID STIMULATING HORMONE', 'TSH'],
  'Triiodothyronine (T3) Total': ['T3 - TOTAL', 'T3 TOTAL', 'TOTAL T3', 'TRIIODOTHYRONINE', 'T3'],
  'Thyroxine (T4) Total':        ['T4 - TOTAL', 'T4 TOTAL', 'TOTAL T4', 'THYROXINE', 'T4'],
  'Free Triiodothyronine':       ['FREE TRIIODOTHYRONINE', 'FREE T3', 'FT3'],
  'Free Thyroxine':              ['FREE THYROXINE', 'FREE T4', 'FT4'],

  // Vitamins
  'Vitamin D':  ['25-OH VITAMIN D (TOTAL)', '25-OH VITAMIN D', 'VITAMIN D TOTAL', '25 HYDROXY VITAMIN D', '25-HYDROXYVITAMIN D', 'VITAMIN D', '25(OH)D'],
  'Vitamin D2': ['25-HYDROXYVITAMIN D2', '25-OH VITAMIN D2', 'VITAMIN D2'],
  'Vitamin D3': ['25-HYDROXYVITAMIN D3', '25-OH VITAMIN D3', 'VITAMIN D3'],
  'Vitamin B12':['VITAMIN B-12', 'VITAMIN B12', 'CYANOCOBALAMIN', 'B12'],
  'Folic Acid': ['FOLIC ACID | FOLATE | VITAMIN B9', 'FOLIC ACID', 'FOLATE', 'VITAMIN B9'],

  // Blood Sugar
  'Fasting Glucose':             ['FASTING BLOOD SUGAR(GLUCOSE)', 'FASTING BLOOD SUGAR', 'FASTING BLOOD GLUCOSE', 'FASTING GLUCOSE', 'GLUCOSE, FASTING', 'FBS', 'FBG'],
  'Glycated Hemoglobin (HbA1c)': ['GLYCATED HEMOGLOBIN', 'GLYCOSYLATED HEMOGLOBIN', 'HEMOGLOBIN A1C', 'HBA1C', 'HB A1C'],
  'Average Blood Glucose':       ['AVERAGE BLOOD GLUCOSE (ABG)', 'AVERAGE BLOOD GLUCOSE', 'MEAN BLOOD GLUCOSE', 'ABG'],

  // Iron Studies
  'Serum Iron':                    ['IRON', 'SERUM IRON'],
  'Total Iron Binding Capacity':   ['TOTAL IRON BINDING CAPACITY (TIBC)', 'TOTAL IRON BINDING CAPACITY', 'TIBC'],
  'Unsaturated Iron Binding Capacity': ['UNSAT.IRON-BINDING CAPACITY(UIBC)', 'UNSAT.IRON-BINDING CAPACITY', 'UNSATURATED IRON BINDING CAPACITY', 'UIBC'],
  'Transferrin Saturation':        ['% TRANSFERRIN SATURATION', 'TRANSFERRIN SATURATION', '% SATURATION'],
  'Ferritin':                      ['SERUM FERRITIN', 'FERRITIN'],

  // Electrolytes
  'Sodium':    ['SODIUM', 'SERUM SODIUM'],
  'Potassium': ['POTASSIUM', 'SERUM POTASSIUM'],
  'Chloride':  ['CHLORIDE', 'SERUM CHLORIDE'],
  'Magnesium': ['MAGNESIUM (MG)', 'MAGNESIUM', 'MG'],
  'Phosphorus':['INORGANIC PHOSPHORUS', 'PHOSPHORUS'],

  // Cardiac
  'High Sensitivity CRP':      ['HIGH SENSITIVITY C-REACTIVE PROTEIN (HSCRP)', 'HIGH SENSITIVITY C-REACTIVE PROTEIN', 'HIGH SENSITIVITY CRP', 'HS-CRP', 'HSCRP'],
  'Homocysteine':               ['HOMOCYSTEINE (HCY)', 'HOMOCYSTEINE', 'HCY'],
  'Apolipoprotein B':           ['APOLIPOPROTEIN B (APO B)', 'APOLIPOPROTEIN B', 'APO-B', 'APO B'],
  'Apolipoprotein A1':          ['APOLIPOPROTEIN A1 (APO A1)', 'APOLIPOPROTEIN A1', 'APO-A1', 'APO A1'],
  'Apolipoprotein B/A1 Ratio':  ['APOLIPOPROTEIN B/A1 (APO B/A1) RATIO', 'APOLIPOPROTEIN B / A 1', 'APOLIPOPROTEIN B/A 1', 'APO B / A 1 RATIO', 'APO B/A1 RATIO', 'APO B/A 1 RATIO', 'APO B/APO A1'],

  // Tumour Markers
  'Cancer Antigen 125':       ['CANCER ANTIGEN 125 (CA 125)', 'CA-125', 'CA 125'],
  'Carbohydrate Antigen 19-9':['CARBOHYDRATE ANTIGEN 19-9 (CA 19-9)', 'CARBOHYDRATE ANTIGEN 19 9 (CA 19 9)', 'CARBOHYDRATE ANTIGEN 199 (CA 199)', 'CARBOHYDRATE ANTIGEN 19 9', 'CA 19-9', 'CA 19 9', 'CA 199'],
  'Carcinoembryonic Antigen': ['CARCINOEMBRYONIC ANTIGEN (CEA)', 'CARCINOEMBRYONIC ANTIGEN', 'CEA'],

  // Immunology
  'Immunoglobulin E':  ['IMMUNOGLOBULIN E (IGE)', 'IMMUNOGLOBULIN E', 'TOTAL IGE', 'IGE'],
  'Rheumatoid Factor': ['RHEUMATOID FACTOR (RF)', 'RHEUMATOID FACTOR', 'RF'],

  // Other
  'Erythrocyte Sedimentation Rate': ['ERYTHROCYTE SEDIMENTATION RATE (ESR)', 'ERYTHROCYTE SEDIMENTATION RATE', 'ESR'],
  'Neutrophil Lymphocyte Ratio':    ['NEUTROPHIL LYMPHOCYTE RATIO (NLR)', 'NEUTROPHIL LYMPHOCYTE RATIO', 'NLR'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Physiological bounds — values outside these are rejected (clinical notes, name tokens)
// ─────────────────────────────────────────────────────────────────────────────
const VALUE_LIMITS = {
  'Hemoglobin':[3,25],'Hematocrit':[10,70],'RBC Count':[1,8],
  'Mean Corpuscular Volume':[50,130],'Mean Corpuscular Hemoglobin':[10,50],
  'Mean Corpuscular Hemoglobin Concentration':[20,45],
  'White Blood Cell Count':[500,100000],'Platelet Count':[10000,2000000],
  'Neutrophils %':[1,100],'Lymphocytes %':[1,100],
  'Monocytes %':[0,30],'Eosinophils %':[0,60],'Basophils %':[0,10],
  'Neutrophils Absolute':[100,20000],'Lymphocytes Absolute':[50,10000],
  'Monocytes Absolute':[10,3000],'Eosinophils Absolute':[0,2000],'Basophils Absolute':[0,500],
  'Mean Platelet Volume':[3,20],'Neutrophil Lymphocyte Ratio':[0.1,30],
  'Total Cholesterol':[50,600],'HDL Cholesterol':[10,150],'LDL Cholesterol':[10,500],
  'VLDL Cholesterol':[5,100],'Triglycerides':[20,3000],
  'AST (Aspartate Aminotransferase)':[3,5000],'ALT (Alanine Transaminase)':[2,5000],
  'AST/ALT Ratio':[0.1,15],'Alkaline Phosphatase':[10,3000],
  'Gamma-Glutamyl Transferase':[2,3000],
  'Bilirubin Total':[0.1,50],'Bilirubin Direct':[0.01,30],'Bilirubin Indirect':[0.01,30],
  'Total Protein':[2,12],'Albumin':[1,8],'Globulin':[0.5,8],'Albumin/Globulin Ratio':[0.1,5],
  'Creatinine':[0.2,20],'Blood Urea Nitrogen':[1,200],'Urea':[3,400],
  'Uric Acid':[1,20],'Calcium':[4,15],'Glomerular Filtration Rate (eGFR)':[1,200],
  'Blood Urea Nitrogen/Creatinine Ratio':[1,100],'Urea/Creatinine Ratio':[10,70],
  'Thyroid Stimulating Hormone':[0.001,100],
  'Triiodothyronine (T3) Total':[0.1,10],'Thyroxine (T4) Total':[0.5,30],
  'Free Triiodothyronine':[0.5,20],'Free Thyroxine':[0.1,10],
  'Vitamin D':[1,200],'Vitamin B12':[50,5000],'Folic Acid':[0.5,80],
  'Fasting Glucose':[30,700],'Glycated Hemoglobin (HbA1c)':[3,20],'Average Blood Glucose':[40,600],
  'Serum Iron':[5,400],'Total Iron Binding Capacity':[50,800],
  'Unsaturated Iron Binding Capacity':[30,600],'Transferrin Saturation':[1,100],'Ferritin':[1,10000],
  'Sodium':[100,180],'Potassium':[1.5,9],'Chloride':[70,130],'Magnesium':[0.5,5],'Phosphorus':[0.5,10],
  'High Sensitivity CRP':[0.01,300],'Homocysteine':[0.5,200],
  'Apolipoprotein B':[10,300],'Apolipoprotein A1':[30,300],'Apolipoprotein B/A1 Ratio':[0.1,5],
  'Cancer Antigen 125':[0.1,5000],'Carbohydrate Antigen 19-9':[0.1,5000],
  'Carcinoembryonic Antigen':[0.1,1000],
  'Immunoglobulin E':[1,50000],'Rheumatoid Factor':[1,500],
  'Erythrocyte Sedimentation Rate':[0,200],'Neutrophil Lymphocyte Ratio':[0.1,30],
};

function inValueRange(canonical, v) {
  const lim = VALUE_LIMITS[canonical];
  if (!lim) return true;
  return v >= lim[0] && v <= lim[1];
}

function unitScale(units) {
  if (!units) return 1;
  const u = units.replace(/\s/g, '');
  if (/10[⁶6]/.test(u)) return 1_000_000;
  if (/10[³3]/.test(u) || /10\^3/.test(u)) return 1000;
  return 1;
}

function scaleRef(ref, scale) {
  if (!ref || scale === 1) return ref;
  // Scale a "lo-hi" range string: "150-410" → "150000-410000"
  return ref.replace(/(\d+\.?\d*)/g, n => String(parseFloat(n) * scale));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference ranges (hardcoded fallback)
// ─────────────────────────────────────────────────────────────────────────────
const REF_RANGES = {
  'Hemoglobin':'13.0-17.0 g/dL','Hematocrit':'40-50 %','RBC Count':'4.5-5.5 x10^6/uL',
  'Mean Corpuscular Volume':'83-101 fL','Mean Corpuscular Hemoglobin':'27-32 pg',
  'Mean Corpuscular Hemoglobin Concentration':'31.5-34.5 g/dL',
  'Red Cell Distribution Width-CV':'11.6-14 %','Red Cell Distribution Width-SD':'39-46 fL',
  'White Blood Cell Count':'4.0-10.0 x10^3/uL',
  'Neutrophils %':'40-80 %','Neutrophils Absolute':'2.0-7.0 x10^3/uL',
  'Lymphocytes %':'20-40 %','Lymphocytes Absolute':'1.0-3.0 x10^3/uL',
  'Monocytes %':'2-10 %','Monocytes Absolute':'0.2-1.0 x10^3/uL',
  'Eosinophils %':'1-6 %','Eosinophils Absolute':'0.02-0.5 x10^3/uL',
  'Basophils %':'0-2 %','Basophils Absolute':'0.02-0.1 x10^3/uL',
  'Platelet Count':'150000-410000 cells/μL','Mean Platelet Volume':'6.5-12 fL',
  'Platelet Distribution Width':'9.6-15.2 fL','Plateletcrit':'0.19-0.39 %',
  'Platelet Large Cell Ratio':'19.7-42.4 %',
  'Total Cholesterol':'< 200 mg/dL','HDL Cholesterol':'40-60 mg/dL',
  'LDL Cholesterol':'< 100 mg/dL','VLDL Cholesterol':'5-40 mg/dL',
  'Triglycerides':'< 150 mg/dL',
  'AST (Aspartate Aminotransferase)':'< 35 U/L','ALT (Alanine Transaminase)':'< 45 U/L',
  'AST/ALT Ratio':'< 2','Alkaline Phosphatase':'45-129 U/L',
  'Gamma-Glutamyl Transferase':'< 55 U/L','Bilirubin Total':'0.3-1.2 mg/dL',
  'Bilirubin Direct':'< 0.20 mg/dL','Bilirubin Indirect':'0-0.9 mg/dL',
  'Total Protein':'5.7-8.2 g/dL','Albumin':'3.2-4.8 g/dL','Globulin':'2.5-3.4 g/dL',
  'Albumin/Globulin Ratio':'0.9-2',
  'Creatinine':'0.72-1.18 mg/dL','Blood Urea Nitrogen':'7.94-20.07 mg/dL',
  'Urea':'17-43 mg/dL','Uric Acid':'4.2-7.3 mg/dL','Calcium':'8.8-10.6 mg/dL',
  'Glomerular Filtration Rate (eGFR)':'>= 90 mL/min/1.73m2',
  'Blood Urea Nitrogen/Creatinine Ratio':'9-23','Urea/Creatinine Ratio':'< 52',
  'Thyroid Stimulating Hormone':'0.35-4.94 uIU/mL',
  'Triiodothyronine (T3) Total':'0.6-1.81 ng/mL','Thyroxine (T4) Total':'4.5-12.5 ug/dL',
  'Free Triiodothyronine':'1.4-4.2 pg/mL','Free Thyroxine':'0.8-1.8 ng/dL',
  'Vitamin D':'30-100 ng/mL','Vitamin D2':'','Vitamin D3':'','Vitamin B12':'211-911 pg/mL',
  'Folic Acid':'3.96-16.76 ng/mL',
  'Fasting Glucose':'70-100 mg/dL','Glycated Hemoglobin (HbA1c)':'< 5.7 %',
  'Average Blood Glucose':'90-120 mg/dL',
  'Serum Iron':'65-175 ug/dL','Total Iron Binding Capacity':'225-535 ug/dL',
  'Unsaturated Iron Binding Capacity':'162-368 ug/dL','Transferrin Saturation':'13-45 %',
  'Ferritin':'12-300 ng/mL',
  'Sodium':'137-145 mmol/L','Potassium':'3.5-5.5 mmol/L','Chloride':'98-107 mmol/L',
  'Magnesium':'1.6-2.3 mg/dL','Phosphorus':'2.5-4.5 mg/dL',
  'High Sensitivity CRP':'< 1 mg/L','Homocysteine':'4.7-12.6 umol/L',
  'Apolipoprotein B':'60-140 mg/dL','Apolipoprotein A1':'105-175 mg/dL',
  'Apolipoprotein B/A1 Ratio':'0.35-0.98',
  'Cancer Antigen 125':'< 35 U/mL','Carbohydrate Antigen 19-9':'< 37 U/mL',
  'Carcinoembryonic Antigen':'< 4 ng/mL',
  'Immunoglobulin E':'< 100 IU/mL','Rheumatoid Factor':'< 14 IU/mL',
  'Erythrocyte Sedimentation Rate':'0-20 mm/h','Neutrophil Lymphocyte Ratio':'1-3',
};

// ─────────────────────────────────────────────────────────────────────────────
// Marker groups — drives table sections and CSV grouping
// ─────────────────────────────────────────────────────────────────────────────
const MARKER_GROUPS = [
  { label: 'CBC', keys: ['Hemoglobin','Hematocrit','RBC Count','Mean Corpuscular Volume','Mean Corpuscular Hemoglobin','Mean Corpuscular Hemoglobin Concentration','Red Cell Distribution Width-CV','Red Cell Distribution Width-SD','White Blood Cell Count','Neutrophils %','Neutrophils Absolute','Lymphocytes %','Lymphocytes Absolute','Monocytes %','Monocytes Absolute','Eosinophils %','Eosinophils Absolute','Basophils %','Basophils Absolute','Platelet Count','Mean Platelet Volume','Platelet Distribution Width','Plateletcrit','Platelet Large Cell Ratio'] },
  { label: 'Lipid', keys: ['Total Cholesterol','HDL Cholesterol','LDL Cholesterol','VLDL Cholesterol','Triglycerides'] },
  { label: 'Liver (LFT)', keys: ['AST (Aspartate Aminotransferase)','ALT (Alanine Transaminase)','AST/ALT Ratio','Alkaline Phosphatase','Gamma-Glutamyl Transferase','Bilirubin Total','Bilirubin Direct','Bilirubin Indirect','Total Protein','Albumin','Globulin','Albumin/Globulin Ratio'] },
  { label: 'Kidney (KFT)', keys: ['Creatinine','Blood Urea Nitrogen','Urea','Uric Acid','Calcium','Glomerular Filtration Rate (eGFR)','Blood Urea Nitrogen/Creatinine Ratio','Urea/Creatinine Ratio'] },
  { label: 'Thyroid', keys: ['Thyroid Stimulating Hormone','Triiodothyronine (T3) Total','Thyroxine (T4) Total','Free Triiodothyronine','Free Thyroxine'] },
  { label: 'Vitamins', keys: ['Vitamin D','Vitamin D2','Vitamin D3','Vitamin B12','Folic Acid'] },
  { label: 'Blood Sugar', keys: ['Fasting Glucose','Glycated Hemoglobin (HbA1c)','Average Blood Glucose'] },
  { label: 'Iron Studies', keys: ['Serum Iron','Total Iron Binding Capacity','Unsaturated Iron Binding Capacity','Transferrin Saturation','Ferritin'] },
  { label: 'Electrolytes', keys: ['Sodium','Potassium','Chloride','Magnesium','Phosphorus'] },
  { label: 'Cardiac', keys: ['High Sensitivity CRP','Homocysteine','Apolipoprotein B','Apolipoprotein A1','Apolipoprotein B/A1 Ratio'] },
  { label: 'Tumour Markers', keys: ['Cancer Antigen 125','Carbohydrate Antigen 19-9','Carcinoembryonic Antigen'] },
  { label: 'Immunology', keys: ['Immunoglobulin E','Rheumatoid Factor'] },
  { label: 'Other', keys: ['Erythrocyte Sedimentation Rate','Neutrophil Lymphocyte Ratio'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Keyword map — keyword (compact form) → candidate canonical names
// Rules: nouns only; 3+ char abbreviations (exceptions: T3, T4, TG); no HB/RF
// ─────────────────────────────────────────────────────────────────────────────
const KEYWORD_MAP = {
  // CBC — cell-type nouns
  'HEMOGLOBIN':  ['Hemoglobin','Mean Corpuscular Hemoglobin','Mean Corpuscular Hemoglobin Concentration','Glycated Hemoglobin (HbA1c)'],
  'HEMATOCRIT':  ['Hematocrit'],
  'LEUCOCYTE':   ['White Blood Cell Count'],
  'LEUKOCYTE':   ['White Blood Cell Count'],
  'NEUTROPHIL':  ['Neutrophils %','Neutrophils Absolute','Neutrophil Lymphocyte Ratio'],
  'LYMPHOCYTE':  ['Lymphocytes %','Lymphocytes Absolute','Neutrophil Lymphocyte Ratio'],
  'MONOCYTE':    ['Monocytes %','Monocytes Absolute'],
  'EOSINOPHIL':  ['Eosinophils %','Eosinophils Absolute'],
  'BASOPHIL':    ['Basophils %','Basophils Absolute'],
  'PLATELET':    ['Platelet Count','Mean Platelet Volume','Platelet Distribution Width','Plateletcrit','Platelet Large Cell Ratio'],
  'MPV':         ['Mean Platelet Volume'],
  'PDW':         ['Platelet Distribution Width'],
  // CBC descriptor keywords
  'WHITE':        ['White Blood Cell Count'],
  'ABSOLUTE':     ['Neutrophils Absolute','Lymphocytes Absolute','Monocytes Absolute','Eosinophils Absolute','Basophils Absolute'],
  'RATIO':        ['Neutrophil Lymphocyte Ratio','AST/ALT Ratio','Albumin/Globulin Ratio','Blood Urea Nitrogen/Creatinine Ratio','Urea/Creatinine Ratio','Apolipoprotein B/A1 Ratio','Platelet Large Cell Ratio'],
  'DISTRIBUTION': ['Red Cell Distribution Width-CV','Red Cell Distribution Width-SD','Platelet Distribution Width'],
  'VOLUME':       ['Mean Corpuscular Volume','Mean Platelet Volume'],
  'CRIT':         ['Hematocrit','Plateletcrit'],
  // CBC abbreviations (3+ chars)
  'WBC':   ['White Blood Cell Count'],
  'TLC':   ['White Blood Cell Count'],
  'RBC':   ['RBC Count'],
  'HGB':   ['Hemoglobin'],
  'HCT':   ['Hematocrit'],
  'PCV':   ['Hematocrit'],
  'MCV':   ['Mean Corpuscular Volume'],
  'MCHC':  ['Mean Corpuscular Hemoglobin Concentration'],  // before MCH — longer wins
  'MCH':   ['Mean Corpuscular Hemoglobin'],
  'RDWCV': ['Red Cell Distribution Width-CV'],
  'RDWSD': ['Red Cell Distribution Width-SD'],
  'RDW':   ['Red Cell Distribution Width-CV','Red Cell Distribution Width-SD'],
  // Absolute count & platelet detail abbreviations removed — covered by noun keywords above,
  // and 3-char forms (ALC, ANC, AMC, AEC) match as substrings inside unrelated words (CALCULATED, PANCREATIC, etc.)
  // Lipid — chemical nouns
  'CHOLESTEROL':    ['Total Cholesterol','HDL Cholesterol','LDL Cholesterol','VLDL Cholesterol'],
  'TRIGLYCERIDE':   ['Triglycerides'],
  'LIPOPROTEIN':    ['HDL Cholesterol','LDL Cholesterol','VLDL Cholesterol','Non-HDL Cholesterol','Apolipoprotein B','Apolipoprotein A1','Apolipoprotein B/A1 Ratio'],
  'APOLIPOPROTEIN': ['Apolipoprotein B','Apolipoprotein A1','Apolipoprotein B/A1 Ratio'],
  // Lipid abbreviations
  // LDL is a substring of VLDL, so both get +1 from LDL keyword on any cholesterol line.
  // Compound keywords break the tie: LDLCHOLESTEROL fires only on LDL lines, VLDLCHOLESTEROL only on VLDL lines.
  'HDL':            ['HDL Cholesterol'],
  'LDL':            ['LDL Cholesterol','VLDL Cholesterol'],
  'LDLCHOLESTEROL':      ['LDL Cholesterol'],
  'CHOLESTEROLLDL':      ['LDL Cholesterol'],
  'VLDL':                ['VLDL Cholesterol'],
  'VLDLCHOLESTEROL':     ['VLDL Cholesterol'],
  'CHOLESTEROLVLDL':     ['VLDL Cholesterol'],
  'TG':   ['Triglycerides'],  // 2-char exception
  // LFT — enzyme/molecule nouns
  'BILIRUBIN':        ['Bilirubin Total','Bilirubin Direct','Bilirubin Indirect'],
  'DIRECT':           ['Bilirubin Direct'],
  'INDIRECT':         ['Bilirubin Indirect'],
  'AMINOTRANSFERASE': ['AST (Aspartate Aminotransferase)','ALT (Alanine Transaminase)','AST/ALT Ratio'],
  'TRANSAMINASE':     ['AST (Aspartate Aminotransferase)','ALT (Alanine Transaminase)','AST/ALT Ratio'],
  'ALANINE':          ['ALT (Alanine Transaminase)'],
  'ASPARTATE':        ['AST (Aspartate Aminotransferase)'],
  'PHOSPHATASE':      ['Alkaline Phosphatase'],
  'ALBUMIN':          ['Albumin','Albumin/Globulin Ratio'],
  'GLOBULIN':         ['Globulin','Albumin/Globulin Ratio'],
  'PROTEIN':          ['Total Protein','Albumin','Globulin'],
  // LFT abbreviations
  'AST':  ['AST (Aspartate Aminotransferase)','AST/ALT Ratio'],
  'SGOT': ['AST (Aspartate Aminotransferase)','AST/ALT Ratio'],
  'ALT':  ['ALT (Alanine Transaminase)','AST/ALT Ratio'],
  'SGPT': ['ALT (Alanine Transaminase)','AST/ALT Ratio'],
  'GGT':  ['Gamma-Glutamyl Transferase'],
  'ALP':  ['Alkaline Phosphatase'],
  // KFT — chemical nouns
  'CREATININE':       ['Creatinine','Glomerular Filtration Rate (eGFR)'],
  'CREATININESERUM':  ['Creatinine'],
  'SERUMCREATININE':  ['Creatinine'],
  'UREA':             ['Urea','Blood Urea Nitrogen'],
  'BLOODUREA':        ['Urea','Blood Urea Nitrogen'],
  'UREANITROGEN':     ['Blood Urea Nitrogen'],
  'URIC':       ['Uric Acid'],
  'URICACID':   ['Uric Acid'],  // compact of "URIC ACID" — catches labs that print full name
  'CALCIUM':    ['Calcium'],
  // KFT abbreviations
  'BUN':  ['Blood Urea Nitrogen','Blood Urea Nitrogen/Creatinine Ratio'],
  'EGFR':       ['Glomerular Filtration Rate (eGFR)'],
  'GLOMERULAR': ['Glomerular Filtration Rate (eGFR)'],
  // Thyroid — chemical nouns
  'THYROID':          ['Thyroid Stimulating Hormone','Triiodothyronine (T3) Total','Thyroxine (T4) Total','Free Triiodothyronine','Free Thyroxine'],
  'THYROXINE':        ['Thyroxine (T4) Total','Free Thyroxine'],
  'TRIIODOTHYRONINE': ['Triiodothyronine (T3) Total','Free Triiodothyronine'],
  // Thyroid abbreviations
  'TSH': ['Thyroid Stimulating Hormone'],
  'FT3': ['Free Triiodothyronine'],
  'FT4': ['Free Thyroxine'],
  'T3':  ['Triiodothyronine (T3) Total'],  // 2-char exception
  'T4':  ['Thyroxine (T4) Total'],         // 2-char exception
  // Vitamins
  'VITAMIN':    ['Vitamin D','Vitamin D2','Vitamin D3','Vitamin B12','Folic Acid'],
  'VITAMIND3':  ['Vitamin D3'],   // before VITAMIND — longer wins
  'VITAMIND2':  ['Vitamin D2'],   // before VITAMIND — longer wins
  'VITAMIND':   ['Vitamin D','Vitamin D2','Vitamin D3'],
  'VITAMINB12': ['Vitamin B12'],
  'CYANOCOBALAMIN': ['Vitamin B12'],
  'FOLIC':      ['Folic Acid'],
  'FOLICACID':  ['Folic Acid'],
  'FOLATE':     ['Folic Acid'],
  // Blood Sugar
  'GLUCOSE': ['Fasting Glucose','Average Blood Glucose'],
  'HBA1C':   ['Glycated Hemoglobin (HbA1c)'],  // "HbA 1 C", "HB A1C" all compact to HBA1C
  // Iron Studies — molecule nouns
  'IRON':        ['Serum Iron','Total Iron Binding Capacity','Unsaturated Iron Binding Capacity','Transferrin Saturation'],
  'FERRITIN':    ['Ferritin'],
  'TRANSFERRIN': ['Total Iron Binding Capacity','Transferrin Saturation'],
  // Iron abbreviations
  'TIBC': ['Total Iron Binding Capacity'],
  'UIBC': ['Unsaturated Iron Binding Capacity'],
  // Electrolytes — element/ion nouns
  'SODIUM':     ['Sodium'],
  'POTASSIUM':  ['Potassium'],
  'CHLORIDE':   ['Chloride'],
  'MAGNESIUM':  ['Magnesium'],
  'PHOSPHORUS': ['Phosphorus'],
  // Cardiac / Immunology / Tumour
  'HOMOCYSTEINE':     ['Homocysteine'],
  'IMMUNOGLOBULIN':   ['Immunoglobulin E'],
  'CARCINOEMBRYONIC': ['Carcinoembryonic Antigen'],
  'CARBOHYDRATE':     ['Carbohydrate Antigen 19-9'],
  'CANCER':           ['Cancer Antigen 125'],
  'ANTIGEN':          ['Cancer Antigen 125','Carbohydrate Antigen 19-9','Carcinoembryonic Antigen'],
  'ANTIGEN125':       ['Cancer Antigen 125'],
  'ANTIGEN199':       ['Carbohydrate Antigen 19-9'],
  'RHEUMATOID':       ['Rheumatoid Factor'],
  // Abbreviations
  'ESR':   ['Erythrocyte Sedimentation Rate'],
  'CRP':   ['High Sensitivity CRP'],
  'HSCRP': ['High Sensitivity CRP'],
  'CEA':   ['Carcinoembryonic Antigen'],
  'IGE':   ['Immunoglobulin E'],
  'CA125': ['Cancer Antigen 125'],
  'CA199': ['Carbohydrate Antigen 19-9'],
};

// Sorted longest-first so more-specific keywords win unambiguous single-canonical matches
const KEYWORD_ENTRIES = Object.entries(KEYWORD_MAP).sort(([a],[b]) => b.length - a.length);

// Reference range hints — auto-built from REF_RANGES for disambiguation
const REF_RANGE_HINTS = {};
for (const [k, v] of Object.entries(REF_RANGES)) {
  const range = v.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
  if (range) { REF_RANGE_HINTS[k] = { lo: +range[1], hi: +range[2] }; continue; }
  const lt = v.match(/^[<≤]\s*(\d+\.?\d*)/);
  if (lt)  { REF_RANGE_HINTS[k] = { lo: 0, hi: +lt[1] }; continue; }
  const gt = v.match(/^[>≥]=?\s*(\d+\.?\d*)/);
  if (gt)  { REF_RANGE_HINTS[k] = { lo: +gt[1], hi: Infinity }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date extraction
// ─────────────────────────────────────────────────────────────────────────────
const MONTH_MAP = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
};

function parseDate(text) {
  // DD/MM/YYYY or DD-MM-YYYY
  let m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (m && parseInt(m[2]) <= 12) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // DD/Mon/YYYY (Tata 1mg: "01/Feb/2026")
  m = text.match(/\b(\d{1,2})\/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\/(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTH_MAP[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,'0')}`;
  // DD MMM[,] YYYY
  m = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,\s]+(\d{4})\b/i);
  if (m) return `${m[3]}-${MONTH_MAP[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,'0')}`;
  return null;
}

function extractDate(lines) {
  const textLines = lines.filter(l => !l.pageBreak && l.text);
  const priority = textLines.filter(l =>
    /coll|collection|sct|date\s*:/i.test(l.text) && !/released|received|report\s*date/i.test(l.text)
  );
  for (const line of [...priority, ...textLines]) {
    const d = parseDate(line.text);
    if (d) return d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF text extraction — group items into lines by Y coordinate
// ─────────────────────────────────────────────────────────────────────────────
function groupIntoLines(items) {
  const BUCKET = 10;
  const map = new Map();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const rawY = item.transform[5];
    const y = Math.round(rawY / BUCKET) * BUCKET;
    if (!map.has(y)) map.set(y, []);
    map.get(y).push({ x: item.transform[4], y: rawY, w: item.width ?? 0, text: item.str.trim() });
  }
  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([bucketY, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      return { bucketY, items: sorted, text: sorted.map(i => i.text).join('  ') };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Column map detection — finds header row, records X positions
// ─────────────────────────────────────────────────────────────────────────────
const COL_PATTERNS = {
  test:      /\b(test|test\s*name|investigation|parameter)\b/i,
  value:     /\b(result|results|value|observed\s*value)\b/i,
  reference: /\b(ref(?:erence)?\.?\s*(?:interval)?|bio\.?\s*ref|biological\s*ref|normal\s*range|b\.r\.i\.?)\b/i,
  units:     /\bunits?\b/i,
};

function detectColMap(line) {
  const colMap = {};
  for (const item of line.items) {
    for (const [col, re] of Object.entries(COL_PATTERNS)) {
      if (!colMap[col] && re.test(item.text)) { colMap[col] = item.x; break; }
    }
  }
  // test and value are mandatory; reference is optional (some pages use TEST NAME | TECHNOLOGY | VALUE | UNITS)
  if (colMap.test === undefined || colMap.value === undefined) return null;
  // test must be the leftmost column (x = 0 or smallest among all detected)
  const allX = Object.values(colMap);
  if (colMap.test !== Math.min(...allX)) return null;
  return colMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact normalisation — strip everything except A-Z 0-9, normalise AE→E
// ─────────────────────────────────────────────────────────────────────────────
function compactNorm(text) {
  return text.replace(/\x00/g, '').toUpperCase().replace(/AE/g, 'E').replace(/[^A-Z0-9]/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker matching — keyword fingerprint on compact line text
// Returns { canonical, candidates } or null
// ─────────────────────────────────────────────────────────────────────────────
function matchLine(lineText) {
  const compact = compactNorm(lineText);
  if (!compact) return null;
  const scores = {};  // canonical → hit count
  for (const [kw, canonicals] of KEYWORD_ENTRIES) {
    if (!compact.includes(kw)) continue;
    for (const c of canonicals) scores[c] = (scores[c] ?? 0) + 1;
  }
  const entries = Object.entries(scores);
  if (!entries.length) return null;
  const maxScore = Math.max(...entries.map(([, s]) => s));
  const winners = entries.filter(([, s]) => s === maxScore).map(([c]) => c);
  const allCandidates = entries.map(([c]) => c);
  if (winners.length === 1) return { canonical: winners[0], candidates: allCandidates };
  return { canonical: null, candidates: allCandidates };
}

// ─────────────────────────────────────────────────────────────────────────────
// Disambiguation — pick best canonical from candidates using PDF ref range
// ─────────────────────────────────────────────────────────────────────────────
function disambiguate(candidates, ref, value = null) {
  // Primary: use ref range printed on the PDF line (overlap scoring)
  if (ref) {
    let refLo, refHi;
    const rm = ref.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
    if (rm) { refLo = +rm[1]; refHi = +rm[2]; }
    const lt = ref.match(/^[<≤]\s*(\d+\.?\d*)/);
    if (lt)  { refLo = 0; refHi = +lt[1]; }
    const gt = ref.match(/^[>≥]=?\s*(\d+\.?\d*)/);
    if (gt)  { refLo = +gt[1]; refHi = Infinity; }
    if (refLo !== undefined) {
      let best = null, bestScore = -1;
      for (const c of candidates) {
        const h = REF_RANGE_HINTS[c];
        if (!h) continue;
        const lo = Math.max(h.lo, refLo);
        const hi = Math.min(h.hi === Infinity ? refHi * 2 : h.hi, refHi === Infinity ? h.lo * 2 + 1 : refHi);
        if (lo <= hi && (hi - lo) > bestScore) { bestScore = hi - lo; best = c; }
      }
      if (best) return best;
    }
  }
  // Fallback: use the extracted value against pre-defined reference range hints
  if (value !== null) {
    const hintMatches = candidates.filter(c => {
      const h = REF_RANGE_HINTS[c];
      if (!h) return false;
      const hi = h.hi === Infinity ? value * 2 + 1 : h.hi;
      return value >= h.lo && value <= hi;
    });
    if (hintMatches.length === 1) return hintMatches[0];
    // Last resort: VALUE_LIMITS (broader physiological bounds)
    const limitMatches = candidates.filter(c => {
      const lim = VALUE_LIMITS[c];
      return lim && value >= lim[0] && value <= lim[1];
    });
    if (limitMatches.length === 1) return limitMatches[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value and reference extraction
// ─────────────────────────────────────────────────────────────────────────────
const NUM_RE   = /^-?\d+\.?\d*$/;
const RANGE_RE = /^\d+\.?\d*\s*[-–]\s*\d+\.?\d*$|^[<>≤≥]=?\s*\d+\.?\d*$|^\d+:\d+\s*[-–]\s*\d+:\d+$/;

function extractValueAndRef(lineItems, alias, colMap) {
  // When alias is provided, find where the marker name ends so we skip name tokens
  let markerEndX = 0;
  if (alias) {
    let accumulated = '';
    for (const item of lineItems) {
      accumulated += (accumulated ? '  ' : '') + item.text;
      if (accumulated.replace(/\s+/g, ' ').toUpperCase().includes(alias)) {
        markerEndX = item.x + item.w;
        break;
      }
    }
  }
  const after = lineItems.filter(i => i.x >= markerEndX - 5);
  let value = null, ref = null, units = '';

  if (colMap && (colMap.value !== undefined || colMap.reference !== undefined)) {
    for (const item of after) {
      const t = item.text.trim();
      if (value === null && colMap.value !== undefined && Math.abs(item.x - colMap.value) < 70) {
        const n = parseFloat(t.replace(/,/g, ''));
        if (!isNaN(n) && NUM_RE.test(t.replace(/,/g, ''))) value = n;
      }
      if (ref === null && colMap.reference !== undefined && Math.abs(item.x - colMap.reference) < 90) {
        if (RANGE_RE.test(t) || /^[<>≤≥]/.test(t)) ref = t;
      }
      if (!units && colMap.units !== undefined && Math.abs(item.x - colMap.units) < 70) {
        if (t && !/^\d+\.?\d*$/.test(t) && !RANGE_RE.test(t)) units = t;
      }
    }
    // Null-byte ref reconstruction (Orange): two separate numeric items near reference column
    if (ref === null && colMap.reference !== undefined) {
      const refNums = after
        .filter(it => Math.abs(it.x - colMap.reference) < 90)
        .map(it => it.text.replace(/\x00/g, '').trim())
        .filter(t => /^\d+\.?\d*$/.test(t));
      if (refNums.length >= 2) ref = refNums[0] + '-' + refNums[1];
    }
  } else {
    // No colMap: scan linearly for first number and first range (no colMap = no position anchor)
    for (const item of after) {
      const t = item.text.trim().replace(/,/g, '');
      if (NUM_RE.test(t)) { value = parseFloat(t); break; }
    }
    for (const item of after) {
      const t = item.text.trim();
      if (RANGE_RE.test(t) || /^[<>≤≥]/.test(t)) { ref = t; break; }
    }
  }
  return { value, ref, units };
}

// ─────────────────────────────────────────────────────────────────────────────
// Look-ahead value — scan next 1-2 lines for a value in VALUE_LIMITS range
// Only stops early if the next line is an *unextracted* marker
// ─────────────────────────────────────────────────────────────────────────────
function lookAheadValue(allLines, i, canonical, colMap, extracted) {
  for (let j = i + 1; j <= Math.min(i + 2, allLines.length - 1); j++) {
    const next = allLines[j];
    if (next.pageBreak) break;
    let value = null, ref = null, units = '';
    if (colMap?.value !== undefined) {
      for (const item of next.items) {
        const t = item.text.trim();
        if (value === null && Math.abs(item.x - colMap.value) < 70) {
          const n = parseFloat(t.replace(/,/g, ''));
          if (!isNaN(n) && NUM_RE.test(t.replace(/,/g, ''))) value = n;
        }
        if (ref === null && colMap.reference !== undefined && Math.abs(item.x - colMap.reference) < 90) {
          if (RANGE_RE.test(t) || /^[<>≤≥]/.test(t)) ref = t;
        }
        if (!units && colMap.units !== undefined && Math.abs(item.x - colMap.units) < 70) {
          if (t && !/^\d+\.?\d*$/.test(t) && !RANGE_RE.test(t)) units = t;
        }
      }
      // Null-byte ref reconstruction (Orange)
      if (ref === null && colMap.reference !== undefined) {
        const refNums = next.items
          .filter(it => Math.abs(it.x - colMap.reference) < 90)
          .map(it => it.text.replace(/\x00/g, '').trim())
          .filter(t => /^\d+\.?\d*$/.test(t));
        if (refNums.length >= 2) ref = refNums[0] + '-' + refNums[1];
      }
    } else {
      for (const item of next.items) {
        const t = item.text.trim().replace(/,/g, '');
        if (NUM_RE.test(t)) { value = parseFloat(t); break; }
      }
    }
    const laScale = unitScale(units);
    if (value !== null) value = value * laScale;
    if (value !== null && inValueRange(canonical, value)) return { value, ref: scaleRef(ref, laScale) };
    // Stop if next line matches an unextracted marker
    const nameItems = colMap?.value !== undefined
      ? next.items.filter(it => it.x < colMap.value - 20)
      : next.items;
    const nm = matchLine(nameItems.map(it => it.text).join(' '));
    if (nm) {
      const nc = nm.canonical ?? disambiguate(nm.candidates, null);
      if (nc && !extracted[nc]) break;
    }
  }
  return { value: null, ref: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Speculative peek — scan next 1-2 lines for value+ref without canonical constraint
// Used when the marker name line has no value (Orange two-line structure)
// ─────────────────────────────────────────────────────────────────────────────
function peekNextValue(allLines, i, colMap) {
  for (let j = i + 1; j <= Math.min(i + 2, allLines.length - 1); j++) {
    const next = allLines[j];
    if (next.pageBreak) break;
    let value = null, ref = null;
    if (colMap?.value !== undefined) {
      for (const item of next.items) {
        const t = item.text.trim();
        if (value === null && Math.abs(item.x - colMap.value) < 70) {
          const n = parseFloat(t.replace(/,/g, ''));
          if (!isNaN(n) && NUM_RE.test(t.replace(/,/g, ''))) value = n;
        }
        if (ref === null && colMap.reference !== undefined && Math.abs(item.x - colMap.reference) < 90) {
          if (RANGE_RE.test(t) || /^[<>≤≥]/.test(t)) ref = t;
        }
      }
      // Null-byte ref reconstruction (Orange)
      if (ref === null && colMap.reference !== undefined) {
        const refNums = next.items
          .filter(it => Math.abs(it.x - colMap.reference) < 90)
          .map(it => it.text.replace(/\x00/g, '').trim())
          .filter(t => /^\d+\.?\d*$/.test(t));
        if (refNums.length >= 2) ref = refNums[0] + '-' + refNums[1];
      }
    } else {
      for (const item of next.items) {
        const t = item.text.trim().replace(/,/g, '');
        if (NUM_RE.test(t)) { value = parseFloat(t); break; }
      }
    }
    if (value !== null) return { value, ref };
  }
  return { value: null, ref: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lines to skip
// ─────────────────────────────────────────────────────────────────────────────
const SKIP_RE = [
  /^\(\s*method\s*:/i,/^\(\s*specimen\s*:/i,/^page\s*:\s*\d/i,/^processed\s*at/i,
  /^patient\s*(name)?[\s:]/i,/^referred\s*by/i,/^sample\s*(collected|received|type|barcode)/i,
  /^report\s*(released|status|date)/i,/^home\s*collection/i,/^tests?\s*done/i,
  /^disclaimer/i,/^please\s*correlate/i,/^method\s*:/i,/^address/i,
  /^branch/i,/^sid\s*no/i,/^reg\s*(date|no)/i,/^dr\./i,/^scan\s*qr/i,
  /^alert\s*!/i,/^\*?note\s*[-–:]/i,/^clinical\s*significance/i,
  /^specifications?:/i,/^conditions\s*of\s*reporting/i,
  /^test\s*name\s*$/i,/^investigation\s*\/?\s*method/i,
];
const shouldSkip = t => SKIP_RE.some(re => re.test(t.trim()));

// ─────────────────────────────────────────────────────────────────────────────
// Parse a single PDF
// ─────────────────────────────────────────────────────────────────────────────
async function parsePDF(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const allLines = [];
  let scanned = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (content.items.length < 8) { scanned++; continue; }
    allLines.push({ pageBreak: true });
    allLines.push(...groupIntoLines(content.items));
  }

  if (scanned === pdf.numPages) {
    throw new Error(`"${file.name}" appears to be a scanned image PDF — text extraction is not possible.`);
  }

  const date = extractDate(allLines.slice(0, 50))
    ?? (window.prompt(`Could not detect date in "${file.name}".\nEnter test date (YYYY-MM-DD):`, '') || 'Unknown');

  const extracted = {};
  let colMap = null;

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (line.pageBreak) { colMap = null; continue; }
    if (shouldSkip(line.text)) continue;
    const newMap = detectColMap(line);
    if (newMap) {
      colMap = newMap;
      // Don't continue — the header line may also contain data (Thyrocare Hemoglobin)
    }

    // Only extract after we've found a header row — skips index/TOC pages
    if (!colMap) continue;

    // Match keywords only against name-column items (left of value column)
    const nameItems = colMap.value !== undefined
      ? line.items.filter(it => it.x < colMap.value - 20)
      : line.items;
    if (!nameItems.length) continue;
    const nameText = nameItems.map(it => it.text).join('  ');

    const lm = matchLine(nameText);
    if (!lm) continue;

    // Extract value+ref+units from the current line
    let { value, ref, units } = extractValueAndRef(line.items, '', colMap);
    const scale = unitScale(units);
    if (value !== null) value = value * scale;
    if (scale !== 1) ref = scaleRef(ref, scale);
    let canonical = lm.canonical ?? disambiguate(lm.candidates, ref, value);

    // Speculative peek: name-only lines (Orange two-line structure) have no value yet —
    // look at the next line to get a value/ref so we can disambiguate.
    // Only peek when current line has no value — otherwise we'd grab the next marker's data.
    if (!canonical && lm.candidates.length > 0 && value === null) {
      const la = peekNextValue(allLines, i, colMap);
      if (la.value !== null) {
        canonical = disambiguate(lm.candidates, la.ref, la.value);
        if (canonical) { value = la.value; ref = la.ref; }
      }
    }

    if (!canonical || extracted[canonical]) continue;

    // Look ahead if value is still missing or out of physiological range
    if (value === null || !inValueRange(canonical, value)) {
      ({ value, ref } = lookAheadValue(allLines, i, canonical, colMap, extracted));
    }

    if (value === null || !inValueRange(canonical, value)) continue;

    extracted[canonical] = { value, ref: ref ?? REF_RANGES[canonical] ?? '' };
  }

  return { date, extracted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result matrix
// ─────────────────────────────────────────────────────────────────────────────
const matrix = {};
const refMap  = {};
let   dates   = [];

function mergeResult({ date, extracted }) {
  if (!dates.includes(date)) dates.push(date);
  for (const [canonical, { value, ref }] of Object.entries(extracted)) {
    if (!matrix[canonical]) matrix[canonical] = {};
    matrix[canonical][date] = value;
    if (!refMap[canonical]) refMap[canonical] = ref || REF_RANGES[canonical] || '';
  }
  dates.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Out-of-range parser
// ─────────────────────────────────────────────────────────────────────────────
function parseRefRange(refStr) {
  if (!refStr) return null;
  const s = refStr.trim();
  let m = s.match(/^([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (m) return { low: parseFloat(m[1]), high: parseFloat(m[2]) };
  m = s.match(/^[<≤]=?\s*([\d.]+)/);
  if (m) return { low: null, high: parseFloat(m[1]) };
  m = s.match(/^[>≥]=?\s*([\d.]+)/);
  if (m) return { low: parseFloat(m[1]), high: null };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV generation (with group rows)
// ─────────────────────────────────────────────────────────────────────────────
function generateCSV() {
  const q    = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Marker', 'Reference Range', ...dates].map(q).join(',')];
  const all  = new Set(Object.keys(matrix));
  const done = new Set();

  const addRow = canonical => {
    rows.push([canonical, refMap[canonical] ?? REF_RANGES[canonical] ?? '', ...dates.map(d => matrix[canonical]?.[d] ?? '')].map(q).join(','));
    done.add(canonical);
  };

  for (const group of MARKER_GROUPS) {
    const present = group.keys.filter(k => all.has(k));
    if (!present.length) continue;
    rows.push([q(group.label), ...Array(1 + dates.length).fill(q(''))].join(','));
    group.keys.forEach(addRow);
  }

  const ungrouped = [...all].filter(k => !done.has(k)).sort();
  if (ungrouped.length) {
    rows.push([q('Other'), ...Array(1 + dates.length).fill(q(''))].join(','));
    ungrouped.forEach(addRow);
  }

  return rows.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Render a single marker row into tbody
// ─────────────────────────────────────────────────────────────────────────────
function renderMarkerRow(tbody, canonical) {
  const ref    = refMap[canonical] ?? REF_RANGES[canonical] ?? '';
  const bounds = parseRefRange(ref);
  const tr     = tbody.insertRow();
  tr.insertCell().textContent = canonical;
  tr.insertCell().textContent = ref;
  for (const d of dates) {
    const td = tr.insertCell();
    const v  = matrix[canonical]?.[d];
    td.textContent     = v !== undefined ? v : '—';
    td.contentEditable = 'true';
    td.className       = 'editable';
    if (v === undefined) {
      td.classList.add('missing');
    } else if (bounds) {
      const outLow  = bounds.low  !== null && v < bounds.low;
      const outHigh = bounds.high !== null && v > bounds.high;
      if (outLow || outHigh) td.classList.add('out-of-range');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Render results table with group headers
// ─────────────────────────────────────────────────────────────────────────────
function renderResults() {
  const section   = document.getElementById('resultsSection');
  const tableWrap = document.getElementById('tableWrap');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const all = new Set(Object.keys(matrix));
  if (!all.size) {
    tableWrap.innerHTML = '<p class="no-results">No known markers found in the uploaded reports.</p>';
    return;
  }

  const colCount = 2 + dates.length;
  const table    = document.createElement('table');
  table.className = 'results-table';

  const thead = table.createTHead();
  const hrow  = thead.insertRow();
  ['Marker', 'Reference Range', ...dates].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hrow.appendChild(th);
  });

  const tbody  = table.createTBody();
  const done   = new Set();

  for (const group of MARKER_GROUPS) {
    const present = group.keys.filter(k => all.has(k));
    if (!present.length) continue;

    const gr  = tbody.insertRow();
    gr.className = 'group-header';
    const gtd = gr.insertCell();
    gtd.colSpan    = colCount;
    gtd.textContent = group.label;

    group.keys.forEach(k => { renderMarkerRow(tbody, k); done.add(k); });
  }

  const ungrouped = [...all].filter(k => !done.has(k)).sort();
  if (ungrouped.length) {
    const gr  = tbody.insertRow();
    gr.className = 'group-header';
    const gtd = gr.insertCell();
    gtd.colSpan     = colCount;
    gtd.textContent = 'Other';
    ungrouped.forEach(k => renderMarkerRow(tbody, k));
  }

  tableWrap.innerHTML = '';
  tableWrap.appendChild(table);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────
function setStatus(msg, type = 'info') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className   = `status-msg status-${type}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main file handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleFiles(files) {
  if (!files.length) return;
  setStatus(`Processing ${files.length} file${files.length > 1 ? 's' : ''}…`);
  const errors = [];
  for (const file of files) {
    try {
      setStatus(`Reading "${file.name}"…`);
      mergeResult(await parsePDF(file));
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
      console.error(err);
    }
  }
  const markerCount = Object.keys(matrix).length;
  setStatus(
    errors.length ? errors.join('\n') : `${markerCount} markers extracted across ${dates.length} report${dates.length > 1 ? 's' : ''}.`,
    errors.length ? 'error' : 'success'
  );
  renderResults();
}

// ─────────────────────────────────────────────────────────────────────────────
// Share as PDF
// ─────────────────────────────────────────────────────────────────────────────
async function shareAsPDF() {
  setStatus('Generating PDF snapshot…');
  try {
    const canvas = await html2canvas(document.body, {
      scale: 2, useCORS: true,
      scrollX: 0, scrollY: -window.scrollY,
      width: document.body.scrollWidth,
      height: document.body.scrollHeight,
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, canvas.width / 2, canvas.height / 2);
    const blob = pdf.output('blob');
    const file = new File([blob], 'track-blood-report.pdf', { type: 'application/pdf' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'My Blood Report — Track Blood' });
    } else {
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
      URL.revokeObjectURL(url);
    }
    setStatus('');
  } catch (err) {
    setStatus('PDF generation failed: ' + err.message, 'error');
    console.error(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Node.js export — allows test.js to require this file directly
// ─────────────────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined') {
  module.exports = { parsePDF, MARKERS, KEYWORD_MAP, VALUE_LIMITS, matchLine, disambiguate, groupIntoLines, extractValueAndRef, peekNextValue };
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const dropzone  = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  document.getElementById('browseBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', e => { if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('dragover'); });
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    const files = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf');
    if (files.length) handleFiles(files);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFiles([...fileInput.files]); });

  document.getElementById('downloadBtn').addEventListener('click', () => {
    const blob = new Blob([generateCSV()], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: `track-blood-${new Date().toISOString().slice(0,10)}.csv` }).click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('shareBtn')?.addEventListener('click', shareAsPDF);
});
