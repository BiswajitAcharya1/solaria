import type { CSSProperties } from 'react'

const STARS = Array.from({ length: 68 }, (_, index) => ({
  left: (index * 37 + 11) % 100,
  top: (index * 61 + 7) % 100,
  size: index % 11 === 0 ? 3 : index % 5 === 0 ? 2 : 1,
  delay: -((index * 0.41) % 5),
  duration: 3.6 + (index % 7) * 0.48,
}))

export default function CosmicBackdrop() {
  return (
    <div className="cosmic-backdrop" aria-hidden="true">
      <div className="atmosphere atmosphere-sage" />
      <div className="atmosphere atmosphere-warm" />

      <svg className="constellation-map" viewBox="0 0 1600 1000" preserveAspectRatio="none">
        <g className="constellation constellation-one">
          <path d="M1022 152 L1138 96 L1245 174 L1358 128 L1450 228 L1372 314 L1245 174 L1188 290 L1092 345" />
          <circle cx="1022" cy="152" r="3" /><circle cx="1138" cy="96" r="2.5" />
          <circle cx="1245" cy="174" r="4" /><circle cx="1358" cy="128" r="2.5" />
          <circle cx="1450" cy="228" r="3.5" /><circle cx="1372" cy="314" r="2" />
          <circle cx="1188" cy="290" r="3" /><circle cx="1092" cy="345" r="2" />
        </g>
        <g className="constellation constellation-two">
          <path d="M180 656 L286 590 L382 655 L474 574 L555 694 L470 795 L382 655 L300 770 L214 736" />
          <circle cx="180" cy="656" r="2.5" /><circle cx="286" cy="590" r="3" />
          <circle cx="382" cy="655" r="4" /><circle cx="474" cy="574" r="2" />
          <circle cx="555" cy="694" r="3" /><circle cx="470" cy="795" r="2.5" />
          <circle cx="300" cy="770" r="3" /><circle cx="214" cy="736" r="2" />
        </g>
        <g className="constellation constellation-three">
          <path d="M956 735 L1040 684 L1128 732 L1212 668 L1305 742 L1380 684" />
          <circle cx="956" cy="735" r="2" /><circle cx="1040" cy="684" r="3" />
          <circle cx="1128" cy="732" r="2.5" /><circle cx="1212" cy="668" r="3.5" />
          <circle cx="1305" cy="742" r="2" /><circle cx="1380" cy="684" r="3" />
        </g>
      </svg>

      <div className="star-field">
        {STARS.map((star, index) => (
          <i
            className="cosmic-star"
            key={index}
            style={{
              '--star-left': `${star.left}%`,
              '--star-top': `${star.top}%`,
              '--star-size': `${star.size}px`,
              '--star-delay': `${star.delay}s`,
              '--star-duration': `${star.duration}s`,
            } as CSSProperties}
          />
        ))}
      </div>

      <i className="shooting-star shooting-star-one" />
      <i className="shooting-star shooting-star-two" />
      <i className="shooting-star shooting-star-three" />
    </div>
  )
}
