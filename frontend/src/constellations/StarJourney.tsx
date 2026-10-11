// Click a star -> a small card: what it is, who it is related to, and (if it has one) its birth family.
// The family's story lives in Families / OriginSim, so the card stays short.
import { useEffect, useMemo, useState } from 'react'
import { loadFamilies } from './familyData'
import { type Star, bvColor, ly } from './physics'
import { RELATION, fate, relate } from './journey'
import './journey.css'

interface Props {
  star: Star
  constellation: Star[]
  catalog: Star[]
  travelsWith: Set<number>
  onClose: () => void
  onPick: (hip: number) => void
  onFamily: (familyId: string) => void
}

type FamilyOf = Map<number, { id: string; name: string; age: number; color: string }>
const familyOf = () => loadFamilies().then(fs => {
  const m: FamilyOf = new Map()
  for (const f of fs) for (const b of f.bright) m.set(b.hip, { id: f.id, name: f.name, age: f.age, color: f.color })
  return m
}).catch(() => new Map() as FamilyOf)

export default function StarJourney({ star, constellation, catalog, travelsWith, onClose, onPick, onFamily }: Props) {
  const [fams, setFams] = useState<FamilyOf | null>(null)
  useEffect(() => { familyOf().then(setFams) }, [])
  const rel = useMemo(() => relate(star, constellation, catalog, travelsWith), [star, constellation, catalog, travelsWith])
  const f = fate(star)
  const fam = fams?.get(star.hip)
  const born = rel.filter(r => r.relation === 'born')
  const moving = rel.filter(r => r.relation === 'moving')
  const kin = born.length ? born : moving
  const kind = born.length ? 'born' : moving.length ? 'moving' : 'aligned'

  return (
    <aside className="sc" aria-label={star.label}>
      <button className="sj-x sc-x" onClick={onClose} aria-label="close">×</button>
      <h3><i style={{ background: bvColor(star.bv), color: bvColor(star.bv) }} />{star.label}</h3>
      <p className="sc-sub">{f.kind} · {ly(star.dist)} light-years away</p>

      <p className="sc-rel">
        <i style={{ background: fam?.color ?? RELATION[kind].color }} />
        <span>
          {fam
            ? <>born in the <b>{fam.name}</b> family, about {Math.round(fam.age)} million years ago, with stars now spread across other constellations.</>
            : kind === 'aligned'
              ? <>not related to the other stars here: it only lines up with them from Earth.</>
              : <>{RELATION[kind].word} with {kin.slice(0, 3).map((r, i) => (
                <span key={r.star.hip}>{i ? ', ' : ''}<button className="sc-link" onClick={() => onPick(r.star.hip)}>{r.star.label}</button></span>
              ))}{kin.length > 3 ? ` and ${kin.length - 3} more` : ''}.</>}
        </span>
      </p>
      {f.explodes && <p className="sc-earth">will end as a supernova. {f.earth}</p>}

      {fam && <button className="sc-go" onClick={() => onFamily(fam.id)}>see its family →</button>}
    </aside>
  )
}
