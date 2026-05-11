/**
 * gamma.js
 *
 * Discrete-gamma site-rate model utilities.
 *
 * Pure-math exports (WASM-free, Node-testable):
 *   normalCDF, normalPPF, bivariateNormalCDF, buildTransitionMatrix
 *
 * WASM integration:
 *   buildRateModel(rMod, M) → { rates, probs, matrix }
 *
 * References:
 *   Genz (2004) / Drezner & Wesolowsky (1990) — bivariate normal CDF
 *   Yang (1995)                                — auto-discrete-gamma copula
 *   Acklam (2003)                              — normal quantile approximation
 */

// ── Normal CDF & PPF ──────────────────────────────────────────────────────────

function _erfc(x) {
  // Abramowitz & Stegun §7.1.26 — max error ~1.5×10⁻⁷
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 +
            t * (-0.284496736 +
            t * (1.421413741 +
            t * (-1.453152027 +
            t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

export function normalCDF(x) {
  return 0.5 * _erfc(-x / Math.SQRT2);
}

export function normalPPF(p) {
  // Acklam rational approximation — max error ~4.5×10⁻⁴
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;

  const a = [-3.969683028665376e+01,  2.209460984245205e+02,
             -2.759285104469687e+02,  1.383577518672690e+02,
             -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01,  1.615858368580409e+02,
             -1.556989798598866e+02,  6.680131188771972e+01,
             -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00,  2.938163982698783e+00];
  const d = [ 7.784695709041462e-03,  3.223964580411365e-01,
              2.400757573452900e+00,  2.549732539343734e+00];

  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
          ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// ── Bivariate normal CDF ──────────────────────────────────────────────────────
// Genz (2004) adaptation of Drezner & Wesolowsky (1990).
// 20-point Gauss-Legendre (10 abscissae, each used at ±).

const _W = [
  0.1527533871307258, 0.1491729864726037, 0.1420961093183821,
  0.1316886384491766, 0.1181945319615184, 0.1019301198172404,
  0.0832767415767048, 0.0626720483341091, 0.0360761573048138,
  0.0171324492379171,
];
const _X = [
  0.0765265211334973, 0.2277858511416451, 0.3737060887154195,
  0.5108670019508271, 0.6360536807265150, 0.7463062256567499,
  0.8391169718222188, 0.9122344282513259, 0.9639719272779138,
  0.9931285991850949,
];

function _bvnd(dh, dk, r) {
  // P(X > dh, Y > dk) for bivariate standard normal, correlation r.
  const TP = 2 * Math.PI;
  let bvn  = 0;

  if (Math.abs(r) < 0.925) {
    const hs  = (dh * dh + dk * dk) / 2;
    const asr = Math.asin(r);
    for (let i = 0; i < 10; i++) {
      for (const sg of [-1, 1]) {
        const sn = Math.sin(asr * (sg * _X[i] + 1) / 2);
        bvn += _W[i] * Math.exp((sn * dh * dk - hs) / (1 - sn * sn));
      }
    }
    return bvn * asr / (4 * Math.PI) + normalCDF(-dh) * normalCDF(-dk);
  }

  // |r| >= 0.925 — use alternative quadrature
  const ldk = r < 0 ? -dk : dk;

  if (Math.abs(r) < 1) {
    const as_ = (1 - r) * (1 + r),  a  = Math.sqrt(as_);
    const bs  = (dh - ldk) ** 2,    c  = (4  - dh * ldk) / 8;
    const d   = (12 - dh * ldk) / 16;
    const asr = -(bs / as_ + dh * ldk) / 2;

    if (asr > -100)
      bvn = a * Math.exp(asr) *
            (1 - c * (bs - as_) * (1 - d * bs / 5) / 3 + c * d * as_ * as_ / 5);

    if (-dh * ldk < 100) {
      const b = Math.sqrt(bs);
      bvn -= Math.exp(-dh * ldk / 2) * Math.sqrt(TP) *
             normalCDF(-b / a) * b * (1 - c * bs * (1 - d * bs / 5) / 3);
    }

    const ah = a / 2;
    for (let i = 0; i < 10; i++) {
      for (const sg of [-1, 1]) {
        const xs   = (ah * (sg * _X[i] + 1)) ** 2;
        const rs   = Math.sqrt(1 - xs);
        const asr2 = -(bs / xs + dh * ldk) / 2;
        if (asr2 > -100)
          bvn += ah * _W[i] * Math.exp(asr2) *
                 (Math.exp(-dh * ldk * (1 - rs) / (2 * (1 + rs))) / rs -
                  (1 + c * xs * (1 + d * xs)));
      }
    }
    bvn /= -TP;
  }

  if (r > 0) return bvn + normalCDF(-Math.max(dh, ldk));
  return -bvn + Math.max(normalCDF(-dh) - normalCDF(-ldk), 0);
}

export function bivariateNormalCDF(h, k, rho) {
  // P(X ≤ h, Y ≤ k) for bivariate standard normal with correlation rho.
  if (!isFinite(h) && h < 0) return 0;
  if (!isFinite(k) && k < 0) return 0;
  if (!isFinite(h))           return normalCDF(k);
  if (!isFinite(k))           return normalCDF(h);
  return Math.max(0, Math.min(1, _bvnd(-h, -k, rho)));
}

// ── Transition matrix (Yang 1995 copula) ──────────────────────────────────────

export function buildTransitionMatrix(K, rho) {
  // Returns K×K matrix M where M[i][j] = P(category j | category i).
  // Category boundaries are the K-quantiles of the standard normal,
  // mapped back through the gamma copula with correlation rho.
  // When rho === 0 each row = [1/K, ..., 1/K] (independent assignment).

  const thr = Array.from({ length: K + 1 }, (_, i) =>
    i === 0 ? -Infinity : i === K ? Infinity : normalPPF(i / K)
  );

  const joint = Array.from({ length: K }, (_, i) =>
    Array.from({ length: K }, (_, j) => Math.max(0,
      bivariateNormalCDF(thr[i + 1], thr[j + 1], rho) -
      bivariateNormalCDF(thr[i],     thr[j + 1], rho) -
      bivariateNormalCDF(thr[i + 1], thr[j],     rho) +
      bivariateNormalCDF(thr[i],     thr[j],     rho)
    ))
  );

  return joint.map(row => {
    const sum = row.reduce((a, b) => a + b, 0);
    return sum < 1e-10 ? Array(K).fill(1 / K) : row.map(v => v / sum);
  });
}

// ── WASM integration ──────────────────────────────────────────────────────────

export function buildRateModel(rMod, M) {
  /**
   * Build rate model parameters ready for factory.set_site_rate_model().
   *
   * rMod fields:
   *   rateVarEnabled  — false → flat single-rate model
   *   gammaAlpha      — gamma shape parameter α
   *   gammaCategories — number of discrete categories K
   *   invarProp       — proportion of invariant sites (0 = off)
   *                     only applied when correlation === 0 and !indelAwareRates
   *   correlation     — ρ for bivariate normal copula (0 = independent)
   *   indelAwareRates — if true, INDEL_AWARE protocol will be used;
   *                     invariant sites disabled in that mode
   *
   * Returns { rates: number[], probs: number[], matrix: number[][] }
   */
  if (!rMod.rateVarEnabled) {
    return { rates: [1.0], probs: [1.0], matrix: [[1.0]] };
  }

  // Discrete gamma rates/probs from WASM
  const gd     = new M.GammaDistribution(rMod.gammaAlpha, rMod.gammaCategories);
  const wRates = gd.getAllRates();
  const wProbs = gd.getAllRatesProb();

  const rates = [], probs = [];
  for (let i = 0; i < wRates.size(); i++) {
    rates.push(wRates.get(i));
    probs.push(wProbs.get(i));
  }
  wRates.delete(); wProbs.delete(); gd.delete();

  // Invariant sites — only when no correlation and not indel-aware
  const useInvar = rMod.invarProp > 0
    && !(rMod.correlation > 0)
    && !rMod.indelAwareRates;

  if (useInvar) {
    const scale = 1 - rMod.invarProp;
    for (let i = 0; i < probs.length; i++) probs[i] *= scale;
    rates.unshift(0.0);
    probs.unshift(rMod.invarProp);
  }

  // Transition matrix
  // Correlation matrix is built from gamma categories only (invariant not mixed in).
  // Independent case: each row = stationary probs vector.
  const K      = probs.length;
  const matrix = rMod.correlation > 0
    ? buildTransitionMatrix(rMod.gammaCategories, rMod.correlation)
    : Array.from({ length: K }, () => [...probs]);

  return { rates, probs, matrix };
}

