export function xfnBuildRefFromArray(field: string, arrobj: any[]): any {
  let refs: any = {};
  let arrlen = arrobj.length;
  for (let i = 0; i < arrlen; i++) {
    refs[arrobj[i][field]] = arrobj[i];
  }
  return refs;
}

export function xfnBuildArrayFromRef(asfield: string, obj: any, ignoreAsField = false): any[] {
  let arr = [];
  let arrlen = obj.length;
  if (ignoreAsField) {
    for (const f in obj) {
      if (obj.hasOwnProperty(f)) {
        const o = obj[f];
        arr.push(o);
      }
    }
  }
  else {
    for (const f in obj) {
      if (obj.hasOwnProperty(f)) {
        const o = obj[f];
        o[asfield] = f;
        arr.push(o);
      }
    }
  }

  return arr;
}

export function xfnInvertMap(obj: any) {
  let newObj: any = {};
  const objkey = Object.keys(obj);
  const objvalues: any = Object.values(obj);
  for (let i = 0; i < objvalues.length; i++) {
    newObj[objvalues[i]] = objkey[i];
  }
  return newObj;
}