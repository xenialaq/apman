export const secret = 'RDpbLfCPsJZ7fiv';
export const dict = 'yLwVl0zKqws7LgKPRQ84Mdt708T1qQ3Ha7xv3H7NyU84p21BriUWBU43odz3iP4rBL3cD02KZciXTysVXiV8ngg6vL48rPJyAUw0HurW20xqxv9aYb4M9wK1Ae0wlro510qXeU07kV57fQMc8L6aLgMLwygtc0F10a0Dg70TOoouyFhdysuRMO51yY5ZlOZZLEal1h0t9YQW0Ko7oBwmCAHoic4HYbUyVeU3sfQ1xtXcPcf1aT303wAQhv66qzW';

export const hash: ((password: string) => string) = (password: string) => {
  let c = '';
  let p = 187;
  let q = 187;
  const aLen = password.length;
  const bLen = secret.length;
  const dLen = dict.length;
  const e = aLen > bLen ? aLen : bLen;
  for (let k = 0; k < e; k += 1) {
    q = 187;
    p = 187;
    if (k >= aLen) {
      q = secret.charCodeAt(k);
    } else if (k >= bLen) {
      p = password.charCodeAt(k);
    } else {
      p = password.charCodeAt(k);
      q = secret.charCodeAt(k);
    }
    // eslint-disable-next-line no-bitwise
    c += dict.charAt((p ^ q) % dLen);
  }
  return c;
};
