import { useRef, useState, type DragEvent } from 'react'

interface Props {
  onFile: (file: File) => void
  busy?: string
}

export function Uploader({ onFile, busy }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) onFile(f)
  }

  return (
    <div
      className={`uploader ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <div className="up-icon">◉</div>
      <div className="up-title">拖入一张照片,或点击选择</div>
      <div className="up-sub">支持 JPG / PNG / WebP · 也可以直接 Ctrl/⌘+V 粘贴 · 处理全程在浏览器内</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      {busy && <div className="up-busy">{busy}</div>}
    </div>
  )
}
