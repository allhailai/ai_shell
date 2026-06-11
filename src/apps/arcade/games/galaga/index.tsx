import type { GameDefinition } from "../../types";
import {
  type GalagaState,
  createInitialState,
  validateState,
} from "./galaga-engine";
import { GalagaGame } from "./GalagaGame";

function GalagaIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      {/* Starfighter silhouette */}
      <path d="M12 2L10 8L4 14L10 12L9 22L12 18L15 22L14 12L20 14L14 8Z" />
    </svg>
  );
}

export const galagaGame: GameDefinition<GalagaState> = {
  id: "galaga",
  name: "Galaga",
  description: "Defend Earth from waves of alien invaders",
  accentColor: "hsl(260, 80%, 55%)",
  icon: GalagaIcon,
  component: GalagaGame,
  createInitialState,
  validateState,
};
