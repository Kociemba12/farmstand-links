// Shared resolver for conversation identity display.
//
// RULE:
//   If the viewer is the farmstand owner  → show the CUSTOMER's identity
//   If the viewer is the customer          → show the FARMSTAND's identity
//
// This mirrors iMessage behaviour: you always see who you're talking TO.

export type ConversationDisplayType = 'customer' | 'farmstand';

export interface ConversationDisplayInput {
  viewerIsFarmstandOwner: boolean;
  farmstandName: string | null | undefined;
  farmstandPhoto: string | null | undefined;
  customerName: string | null | undefined;
  customerPhoto: string | null | undefined;
}

export interface ConversationDisplay {
  displayName: string;
  displayPhoto: string | null;
  displayType: ConversationDisplayType;
}

export function resolveConversationDisplay(
  input: ConversationDisplayInput
): ConversationDisplay {
  const { viewerIsFarmstandOwner, farmstandName, farmstandPhoto, customerName, customerPhoto } =
    input;

  if (viewerIsFarmstandOwner) {
    // Viewer is the farmer → show the customer on the other side
    console.log(
      '[ConvDisplay] viewer=farmstand-owner → showing customer identity | name:', customerName, '| photo:', customerPhoto
    );
    return {
      displayName: customerName ?? 'Customer',
      displayPhoto: customerPhoto ?? null,
      displayType: 'customer',
    };
  }

  // Viewer is the customer → show the farmstand on the other side
  console.log(
    '[ConvDisplay] viewer=customer → showing farmstand identity | name:', farmstandName, '| photo:', farmstandPhoto
  );
  return {
    displayName: farmstandName ?? 'Farmstand',
    displayPhoto: farmstandPhoto ?? null,
    displayType: 'farmstand',
  };
}
