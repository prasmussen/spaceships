/** Move pre-rename preferences once, without overwriting newer settings. */
export function migratePreferences(storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
  for(const suffix of ['controls-v3','controls-v2','controls','reduced-motion','sound']){
    const previous=`cavern-${suffix}`,current=`spaceships-${suffix}`;
    const value=storage.getItem(previous);
    if(value===null)continue;
    if(storage.getItem(current)===null)storage.setItem(current,value);
    storage.removeItem(previous);
  }
}
