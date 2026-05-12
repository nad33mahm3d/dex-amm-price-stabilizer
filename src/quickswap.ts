export type Reserves = {
  reserveBase: bigint;
  reserveUsdc: bigint;
  reserve0?: bigint;
  reserve1?: bigint;
  token0?: string;
  token1?: string;
};

import type { JsonRpcProvider, Wallet } from "ethers";
import { createErc20 } from "./erc20";

export async function computePriceUsdcPerBaseScaled(
  reserves: Reserves,
  decimalsBase: number,
  decimalsUsdc: number,
  scalePow: number
): Promise<bigint> {
  const scale = 10n ** BigInt(scalePow);
  return (
    (reserves.reserveUsdc * 10n ** BigInt(decimalsBase) * scale) /
    (reserves.reserveBase * 10n ** BigInt(decimalsUsdc))
  );
}

export async function approveIfNeeded(params: {
  tokenAddress: string;
  owner: Wallet;
  routerAddress: string;
  amountIn: bigint;
  dryRun: boolean;
}): Promise<void> {
  const { tokenAddress, owner, routerAddress, amountIn, dryRun } = params;
  if (!owner.provider) throw new Error("Wallet has no provider");
  const token = createErc20(tokenAddress, owner.provider as JsonRpcProvider);

  const allowance: bigint = BigInt((await token.allowance(owner.address, routerAddress)).toString());
  if (allowance >= amountIn) return;

  if (dryRun) {
    return;
  }

  const tokenWithSigner = token.connect(owner);
  const tx = await (tokenWithSigner as any).approve(routerAddress, amountIn);
  await tx.wait();
}
