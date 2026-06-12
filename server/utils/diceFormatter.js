// utils/diceFormatter.js
export function rollDice(count, sides) {
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  return { rolls, sum };
}

export function formatRollFormula(count, sides, modifier, sum, totalPercent) {
  if (totalPercent !== undefined) {
    return `d20 (${count}) + ${modifier} (${totalPercent}%) = ${sum}`;
  }
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '';
  return `${count}d${sides}${modStr} = ${sum}`;
}
