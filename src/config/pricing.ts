// What we charge the customer per message (in USD)
export const PRICING = {
  whatsapp: {
    outbound: 0.030,   // business-initiated
    inbound:  0.008,   // user-initiated (cheaper)
  },
  sms: {
    default: 0.008,    // per SMS segment
    india:   0.005,
  },
  email: {
    default: 0.001,    // per email
  },
};

// Our actual cost from providers (for margin tracking)
export const PROVIDER_COST = {
  whatsapp: { outbound: 0.015, inbound: 0.004 },
  sms:      { default: 0.004, india: 0.002 },
  email:    { default: 0.0002 },
};

export const getMessageCost = (channel: 'whatsapp' | 'sms' | 'email', country?: string): { charged: number; actual: number } => {
  if (channel === 'whatsapp') {
    return { charged: PRICING.whatsapp.outbound, actual: PROVIDER_COST.whatsapp.outbound };
  }
  if (channel === 'sms') {
    const isIndia = country === 'IN';
    return {
      charged: isIndia ? PRICING.sms.india : PRICING.sms.default,
      actual:  isIndia ? PROVIDER_COST.sms.india : PROVIDER_COST.sms.default,
    };
  }
  return { charged: PRICING.email.default, actual: PROVIDER_COST.email.default };
};
