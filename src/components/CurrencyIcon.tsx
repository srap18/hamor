import coinImg from "@/assets/icon-coin-3d.png";
import gemImg from "@/assets/icon-gem-3d.png";
import rubyImg from "@/assets/icon-ruby-3d.png";

type Props = { size?: number; className?: string };

const base = "inline-block align-middle drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)] select-none";

export function CoinIcon({ size = 20, className = "" }: Props) {
  return <img src={coinImg} alt="coins" width={size} height={size} loading="lazy" className={`${base} ${className}`} style={{ width: size, height: size }} />;
}
export function GemIcon({ size = 20, className = "" }: Props) {
  return <img src={gemImg} alt="gems" width={size} height={size} loading="lazy" className={`${base} ${className}`} style={{ width: size, height: size }} />;
}
export function RubyIcon({ size = 20, className = "" }: Props) {
  return <img src={rubyImg} alt="rubies" width={size} height={size} loading="lazy" className={`${base} ${className}`} style={{ width: size, height: size }} />;
}
