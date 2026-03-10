Create a collateral agreement
Create a new agreement
Before a user (party A) can instruct collateral over to another user on the platform, they need to have an active agreement in place with another party on the platform. This is to ensure the existence of a CSA (Credit Support Annex) that is currently in place between these two parties. To create this agreement within the Collateral Utility, the user needs to provide the following details that have been agreed as part of the CSA:

Agreement ID - a unique identifier from the ISDA / CSA agreement between the two parties.

Counterparty (Party B) - the application ID of the party that the user wants to establish the agreement with.

Eligible collateral - select all the eligible collateral types as agreed in the CSA.

Accept / reject agreement
Once party A has created an agreement request, they will have the option to cancel the request before party B responds to it. Party B will be able to see the new agreement request on their side and decide whether to either accept or reject it.

The state of each agreement can be seen from the ‘Agreements’ tab within the Collateral Utility.


Settle a margin call
Instruct collateral
In order to settle a margin call, users can select the button to ‘Instruct Collateral’ under the ‘Collateral’ tab within the Collateral Utility. This function will allow the user to create a collateral offer that is valid for a pre-agreed time frame and collateral type with the counterparty they need to settle the margin call with. To create the offer the user will need to provide the following information:

Collateral Agreement - select from the drop down list the relevant agreement for the transfer.

Allocation Date - set the date and time by which the collateral amount will be allocated away from the user’s account for transfer.

Settle Date - set the date and time by which the collateral transfer needs to be settled by i.e. will be reflected over in the counterparty’s account.

Select collateral - the user needs to select the collateral type and amount that are required by the margin call.

Instruct ID - create an unique identifier for this particular collateral instruction.

Once the collateral offer has been created the user will be able to see a record of it with an ‘instructed’ state on the ‘Collateral’ tab.

Cancel instruction
A collateral offer with an ‘instructed’ state can be cancelled by the sender or rejected by the receiver whilst in that state.

Allocation request
The sender of the collateral instruction needs to ensure that they have sufficient funds within their holdings so that they can be allocated over for transfer within the agreed ‘allocation date’. A notification within the Collateral Utility will prompt the sender to go over to the Registry Utility -> Allocation requests and confirm the allocation.

Settle
Only after the funds have been allocated to that collateral offer, can the sender then go back to the ‘Collateral’ tab in the Collateral Utility and click to ‘settle’ the offer. This will ensure that the allocated funds are transferred over to the counterparty and also update the collateral offer record as now having a ‘settled’ state. This state now reflects the end of the workflow to settle a margin call within the utility.