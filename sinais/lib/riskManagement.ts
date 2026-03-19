/**
 * Utilitários para gestão de risco
 */

/**
 * Calcula o tamanho da posição baseado em risco percentual
 * @param balance Saldo total em USDT
 * @param riskPercent Percentual de risco por trade (padrão: 2%)
 * @param entry Preço de entrada
 * @param stop Preço de stop loss
 * @returns Quantidade de contratos/tokens
 */
export function calculatePositionSize(
  balance: number,
  riskPercent: number,
  entry: number,
  stop: number
): number {
  const riskUSDT = balance * (riskPercent / 100);
  const riskPerUnit = Math.abs(entry - stop);

  if (riskPerUnit === 0) {
    return 0;
  }

  const qty = riskUSDT / riskPerUnit;
  return qty;
}

/**
 * Ajusta a quantidade ao stepSize/lotSize da exchange
 * @param qty Quantidade calculada
 * @param stepSize Tamanho do step (ex: 0.001)
 * @returns Quantidade ajustada
 */
export function adjustQuantityToStepSize(qty: number, stepSize: number): number {
  if (stepSize <= 0) {
    return qty;
  }

  const steps = Math.floor(qty / stepSize);
  return steps * stepSize;
}

/**
 * Calcula o risco em USDT de uma posição
 * @param qty Quantidade
 * @param entry Preço de entrada
 * @param stop Preço de stop loss
 * @returns Risco em USDT
 */
export function calculateRiskUSDT(qty: number, entry: number, stop: number): number {
  return qty * Math.abs(entry - stop);
}

/**
 * Calcula o risco percentual de uma posição
 * @param balance Saldo total
 * @param qty Quantidade
 * @param entry Preço de entrada
 * @param stop Preço de stop loss
 * @returns Risco percentual
 */
export function calculateRiskPercent(
  balance: number,
  qty: number,
  entry: number,
  stop: number
): number {
  if (balance === 0) {
    return 0;
  }

  const riskUSDT = calculateRiskUSDT(qty, entry, stop);
  return (riskUSDT / balance) * 100;
}

/**
 * Calcula o valor da posição em USDT
 * @param qty Quantidade
 * @param entry Preço de entrada
 * @returns Valor da posição em USDT
 */
export function calculatePositionValue(qty: number, entry: number): number {
  return qty * entry;
}

/**
 * Calcula o R:R (Risk:Reward) de um trade
 * @param entry Preço de entrada
 * @param stop Preço de stop loss
 * @param target Preço do target
 * @returns R:R ratio
 */
export function calculateRiskReward(
  entry: number,
  stop: number,
  target: number
): number {
  const risk = Math.abs(entry - stop);
  if (risk === 0) {
    return 0;
  }

  const reward = Math.abs(target - entry);
  return reward / risk;
}





