/**
 * Shop customer accounts: registration at checkout, order history, saved
 * addresses. Deliberately separate from `modules/auth`, which is the staff
 * side — see `db/adapters/mysql/schema/customers.ts` for why.
 */
export {
  CUSTOMER_COOKIE_NAME,
  CUSTOMER_SESSION_TTL_SECONDS,
  signCustomerToken,
  verifyCustomerToken,
  type CustomerClaims,
} from './token';
export { clearCustomerCookie, readCustomerCookie, setCustomerCookie } from './session';
export { readCurrentCustomer, requireApiCustomer } from './guards';
export {
  checkoutPrefill,
  planCheckoutAccount,
  type CheckoutAccountPlan,
  type CheckoutPrefill,
} from './checkout';
export { attachCheckoutAccount, resolveCheckoutCustomerId } from './checkout-service';
export {
  anonymisedCustomer,
  applyDefaultAddressFlags,
  buildCustomerExport,
  canAddAddress,
  canClaimGuestOrders,
  MAX_CUSTOMER_ADDRESSES,
  isActiveCustomer,
  normalizeCustomerEmail,
  publicCustomer,
  type CustomerAddressRow,
  type CustomerRow,
  type CustomerStatus,
  type PublicCustomer,
} from './policy';
export {
  CUSTOMER_TOKEN_TTL_SECONDS,
  hashCustomerToken,
  isTokenUsable,
  newCustomerToken,
  tokenExpiry,
  type CustomerTokenPurpose,
  type CustomerTokenRow,
} from './tokens';
export {
  authenticateCustomer,
  changeCustomerPassword,
  claimGuestOrders,
  deleteCustomerAccount,
  deleteCustomerAddress,
  exportCustomerData,
  findCustomerByEmail,
  findCustomerById,
  getCustomerOrder,
  issueCustomerToken,
  listCustomerAddresses,
  listCustomerOrders,
  registerCustomer,
  resetCustomerPassword,
  saveCustomerAddress,
  updateCustomerProfile,
  verifyCustomerEmail,
  type AddressInput,
  type AuthOutcome,
  type RegisterOutcome,
} from './service';
export {
  customerAddressRoute,
  customerAddressesRoute,
  customerDeleteRoute,
  customerExportRoute,
  customerForgotRoute,
  customerLoginRoute,
  customerLogoutRoute,
  customerMeRoute,
  customerOrderRoute,
  customerOrdersRoute,
  customerPasswordRoute,
  customerProfileRoute,
  customerRegisterRoute,
  customerResetRoute,
  customerVerifyRoute,
  type CustomerRouteOptions,
} from './routes';
export {
  sendAlreadyRegisteredEmail,
  sendPasswordChangedEmail,
  sendResetEmail,
  sendVerifyEmail,
} from './emails';
export {
  getCustomerForAdmin,
  listCustomers,
  setCustomerStatus,
  type AdminCustomerRow,
  type ListCustomersOptions,
} from './admin';
export { customerGetRoute, customersListRoute, customerUpdateRoute } from './admin-routes';
