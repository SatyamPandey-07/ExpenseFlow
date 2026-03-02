/**
 * Tax Forms Generator
 * Generates tax forms including 1099, W-2, 1040 Schedule C, and VAT returns
 */

class TaxFormsGenerator {
    constructor() {
        this.forms = new Map();
        this.currentYear = new Date().getFullYear();
    }

    /**
     * Generate Form 1099-MISC
     */
    generate1099MISC(data) {
        const form = {
            formType: '1099-MISC',
            formTitle: 'Miscellaneous Information',
            taxYear: data.taxYear || this.currentYear,
            generatedDate: new Date().toISOString(),
            status: 'draft',
            data: {
                payerInfo: {
                    name: data.payerName || '',
                    address: data.payerAddress || '',
                    city: data.payerCity || '',
                    state: data.payerState || '',
                    zip: data.payerZip || '',
                    ein: data.payerEIN || '',
                    phone: data.payerPhone || ''
                },
                recipientInfo: {
                    name: data.recipientName || '',
                    address: data.recipientAddress || '',
                    city: data.recipientCity || '',
                    state: data.recipientState || '',
                    zip: data.recipientZip || '',
                    tin: data.recipientTIN || '',
                    accountNumber: data.accountNumber || ''
                },
                amounts: {
                    box1_rents: data.rents || 0,
                    box2_royalties: data.royalties || 0,
                    box3_otherIncome: data.otherIncome || 0,
                    box4_federalTaxWithheld: data.federalTaxWithheld || 0,
                    box5_fishingBoatProceeds: data.fishingBoatProceeds || 0,
                    box6_medicalHealthcare: data.medicalHealthcare || 0,
                    box7_nonemployeeCompensation: data.nonemployeeCompensation || 0,
                    box8_substitutePayments: data.substitutePayments || 0,
                    box9_cropInsurance: data.cropInsurance || 0,
                    box10_grossProceeds: data.grossProceeds || 0
                }
            }
        };

        const formId = this.saveForm(form);
        return { ...form, formId };
    }

    /**
     * Generate Form W-2
     */
    generateW2(data) {
        const form = {
            formType: 'W-2',
            formTitle: 'Wage and Tax Statement',
            taxYear: data.taxYear || this.currentYear,
            generatedDate: new Date().toISOString(),
            status: 'draft',
            data: {
                employerInfo: {
                    name: data.employerName || '',
                    address: data.employerAddress || '',
                    city: data.employerCity || '',
                    state: data.employerState || '',
                    zip: data.employerZip || '',
                    ein: data.employerEIN || ''
                },
                employeeInfo: {
                    name: data.employeeName || '',
                    ssn: data.employeeSSN || '',
                    address: data.employeeAddress || '',
                    city: data.employeeCity || '',
                    state: data.employeeState || '',
                    zip: data.employeeZip || ''
                },
                amounts: {
                    box1_wages: data.wages || 0,
                    box2_federalTaxWithheld: data.federalTaxWithheld || 0,
                    box3_socialSecurityWages: data.socialSecurityWages || 0,
                    box4_socialSecurityTaxWithheld: data.socialSecurityTaxWithheld || 0,
                    box5_medicareWages: data.medicareWages || 0,
                    box6_medicareTaxWithheld: data.medicareTaxWithheld || 0,
                    box7_socialSecurityTips: data.socialSecurityTips || 0,
                    box8_allocatedTips: data.allocatedTips || 0,
                    box10_dependentCareBenefits: data.dependentCareBenefits || 0,
                    box11_nonqualifiedPlans: data.nonqualifiedPlans || 0,
                    box12_codes: data.box12Codes || [],
                    box13_statutory: data.statutory || false,
                    box13_retirement: data.retirementPlan || false,
                    box13_thirdParty: data.thirdPartySickPay || false,
                    box14_other: data.other || [],
                    box15_state: data.state || '',
                    box15_ein: data.stateEIN || '',
                    box16_stateWages: data.stateWages || 0,
                    box17_stateTax: data.stateTax || 0,
                    box18_localWages: data.localWages || 0,
                    box19_localTax: data.localTax || 0,
                    box20_locality: data.locality || ''
                }
            }
        };

        const formId = this.saveForm(form);
        return { ...form, formId };
    }

    /**
     * Generate Schedule C (Profit or Loss from Business)
     */
    generateScheduleC(data) {
        const grossIncome = data.grossReceipts || 0;
        const returns = data.returnsAllowances || 0;
        const grossProfit = grossIncome - returns;
        
        const totalExpenses = Object.values(data.expenses || {}).reduce((sum, val) => sum + val, 0);
        const netProfit = grossProfit - totalExpenses;

        const form = {
            formType: 'Schedule-C',
            formTitle: 'Profit or Loss From Business (Sole Proprietorship)',
            taxYear: data.taxYear || this.currentYear,
            generatedDate: new Date().toISOString(),
            status: 'draft',
            data: {
                businessInfo: {
                    name: data.businessName || '',
                    address: data.businessAddress || '',
                    city: data.businessCity || '',
                    state: data.businessState || '',
                    zip: data.businessZip || '',
                    ein: data.ein || '',
                    businessCode: data.businessCode || '',
                    accountingMethod: data.accountingMethod || 'Cash',
                    materialParticipation: data.materialParticipation !== false
                },
                partI_income: {
                    grossReceipts: grossIncome,
                    returnsAllowances: returns,
                    grossIncome: grossProfit,
                    otherIncome: data.otherIncome || 0,
                    totalIncome: grossProfit + (data.otherIncome || 0)
                },
                partII_expenses: {
                    advertising: data.expenses?.advertising || 0,
                    carAndTruck: data.expenses?.carAndTruck || 0,
                    commissions: data.expenses?.commissions || 0,
                    contractLabor: data.expenses?.contractLabor || 0,
                    depletion: data.expenses?.depletion || 0,
                    depreciation: data.expenses?.depreciation || 0,
                    employeeBenefits: data.expenses?.employeeBenefits || 0,
                    insurance: data.expenses?.insurance || 0,
                    interest: data.expenses?.interest || 0,
                    legalProfessional: data.expenses?.legalProfessional || 0,
                    officeExpense: data.expenses?.officeExpense || 0,
                    pensionPlans: data.expenses?.pensionPlans || 0,
                    rentLease: data.expenses?.rentLease || 0,
                    repairs: data.expenses?.repairs || 0,
                    supplies: data.expenses?.supplies || 0,
                    taxes: data.expenses?.taxes || 0,
                    travel: data.expenses?.travel || 0,
                    mealsEntertainment: (data.expenses?.meals || 0) * 0.5, // 50% deductible
                    utilities: data.expenses?.utilities || 0,
                    wages: data.expenses?.wages || 0,
                    other: data.expenses?.other || 0,
                    totalExpenses: totalExpenses
                },
                partIII_costOfGoodsSold: {
                    inventory_beginning: data.cogs?.inventoryBeginning || 0,
                    purchases: data.cogs?.purchases || 0,
                    laborCosts: data.cogs?.laborCosts || 0,
                    materials: data.cogs?.materials || 0,
                    other: data.cogs?.other || 0,
                    inventory_ending: data.cogs?.inventoryEnding || 0,
                    totalCOGS: this.calculateCOGS(data.cogs)
                },
                partIV_vehicle: data.vehicleInfo || null,
                partV_other: data.otherInfo || {},
                netProfit: netProfit
            }
        };

        const formId = this.saveForm(form);
        return { ...form, formId };
    }

    /**
     * Generate Form 1040 (Individual Income Tax Return)
     */
    generate1040(data) {
        const standardDeduction = this.getStandardDeduction(data.filingStatus);
        const deductions = data.itemizedDeductions > standardDeduction 
            ? data.itemizedDeductions 
            : standardDeduction;
        
        const adjustedGrossIncome = data.totalIncome - (data.adjustments || 0);
        const taxableIncome = Math.max(0, adjustedGrossIncome - deductions);

        const form = {
            formType: '1040',
            formTitle: 'U.S. Individual Income Tax Return',
            taxYear: data.taxYear || this.currentYear,
            generatedDate: new Date().toISOString(),
            status: 'draft',
            data: {
                filingInfo: {
                    filingStatus: data.filingStatus || 'single',
                    firstName: data.firstName || '',
                    lastName: data.lastName || '',
                    ssn: data.ssn || '',
                    address: data.address || '',
                    city: data.city || '',
                    state: data.state || '',
                    zip: data.zip || '',
                    spouse: data.spouse || null,
                    dependents: data.dependents || []
                },
                income: {
                    wages: data.wages || 0,
                    taxableInterest: data.taxableInterest || 0,
                    dividends: data.dividends || 0,
                    taxableRefunds: data.taxableRefunds || 0,
                    businessIncome: data.businessIncome || 0,
                    capitalGains: data.capitalGains || 0,
                    otherIncome: data.otherIncome || 0,
                    totalIncome: data.totalIncome || 0
                },
                adjustments: {
                    educatorExpenses: data.adjustments?.educatorExpenses || 0,
                    hsaDeduction: data.adjustments?.hsaDeduction || 0,
                    studentLoanInterest: data.adjustments?.studentLoanInterest || 0,
                    iraDeduction: data.adjustments?.iraDeduction || 0,
                    selfEmploymentTax: data.adjustments?.selfEmploymentTax || 0,
                    totalAdjustments: data.adjustments || 0
                },
                agi: adjustedGrossIncome,
                deductions: {
                    standardDeduction: standardDeduction,
                    itemizedDeductions: data.itemizedDeductions || 0,
                    totalDeductions: deductions
                },
                taxableIncome: taxableIncome,
                tax: data.taxCalculated || 0,
                credits: {
                    childTaxCredit: data.credits?.childTaxCredit || 0,
                    educationCredit: data.credits?.educationCredit || 0,
                    earnedIncomeCredit: data.credits?.earnedIncomeCredit || 0,
                    otherCredits: data.credits?.other || 0,
                    totalCredits: data.totalCredits || 0
                },
                payments: {
                    federalWithheld: data.federalWithheld || 0,
                    estimatedPayments: data.estimatedPayments || 0,
                    otherPayments: data.otherPayments || 0,
                    totalPayments: data.totalPayments || 0
                },
                refundOrAmount: data.refundOrAmount || 0
            }
        };

        const formId = this.saveForm(form);
        return { ...form, formId };
    }

    /**
     * Generate VAT Return
     */
    generateVATReturn(data) {
        const vatOnSales = (data.sales || 0) * (data.vatRate || 0.20);
        const vatOnPurchases = (data.purchases || 0) * (data.vatRate || 0.20);
        const netVAT = vatOnSales - vatOnPurchases;

        const form = {
            formType: 'VAT',
            formTitle: 'Value Added Tax Return',
            taxYear: data.taxYear || this.currentYear,
            period: data.period || 'Q1',
            generatedDate: new Date().toISOString(),
            status: 'draft',
            data: {
                businessInfo: {
                    name: data.businessName || '',
                    vatNumber: data.vatNumber || '',
                    address: data.address || '',
                    city: data.city || '',
                    country: data.country || '',
                    postalCode: data.postalCode || ''
                },
                vatOnSales: {
                    standardRate_sales: data.standardRateSales || 0,
                    standardRate_vat: (data.standardRateSales || 0) * (data.vatRate || 0.20),
                    reducedRate_sales: data.reducedRateSales || 0,
                    reducedRate_vat: (data.reducedRateSales || 0) * (data.reducedVatRate || 0.05),
                    zeroRated_sales: data.zeroRatedSales || 0,
                    exempt_sales: data.exemptSales || 0,
                    totalVATOnSales: vatOnSales
                },
                vatOnPurchases: {
                    standardRate_purchases: data.standardRatePurchases || 0,
                    standardRate_vat: (data.standardRatePurchases || 0) * (data.vatRate || 0.20),
                    reducedRate_purchases: data.reducedRatePurchases || 0,
                    reducedRate_vat: (data.reducedRatePurchases || 0) * (data.reducedVatRate || 0.05),
                    totalVATOnPurchases: vatOnPurchases
                },
                netVAT: netVAT,
                vatToPay: netVAT > 0 ? netVAT : 0,
                vatToReclaim: netVAT < 0 ? Math.abs(netVAT) : 0
            }
        };

        const formId = this.saveForm(form);
        return { ...form, formId };
    }

    /**
     * Generate State Tax Return (Generic Template)
     */
    generateStateTaxReturn(data) {
        const form = {
            formType: 'State',
            formTitle: `${data.state || 'State'} Income Tax Return`,
            taxYear: data.taxYear || this.currentYear,
            generatedDate: new Date().toISOString(),
            status: 'draft',
            data: {
                taxpayerInfo: {
                    name: data.name || '',
                    ssn: data.ssn || '',
                    address: data.address || '',
                    city: data.city || '',
                    state: data.state || '',
                    zip: data.zip || ''
                },
                income: {
                    federalAGI: data.federalAGI || 0,
                    stateAdjustments: data.stateAdjustments || 0,
                    stateIncome: (data.federalAGI || 0) + (data.stateAdjustments || 0)
                },
                deductions: data.deductions || 0,
                exemptions: data.exemptions || 0,
                taxableIncome: Math.max(0, (data.federalAGI || 0) - (data.deductions || 0)),
                stateTax: data.stateTax || 0,
                credits: data.credits || 0,
                withheld: data.withheld || 0,
                refundOrAmount: data.refundOrAmount || 0
            }
        };

        const formId = this.saveForm(form);
        return { ...form, formId };
    }

    /**
     * Calculate Cost of Goods Sold
     */
    calculateCOGS(cogsData) {
        if (!cogsData) return 0;
        
        const beginning = cogsData.inventoryBeginning || 0;
        const purchases = cogsData.purchases || 0;
        const labor = cogsData.laborCosts || 0;
        const materials = cogsData.materials || 0;
        const other = cogsData.other || 0;
        const ending = cogsData.inventoryEnding || 0;

        return beginning + purchases + labor + materials + other - ending;
    }

    /**
     * Get standard deduction based on filing status
     */
    getStandardDeduction(filingStatus) {
        const deductions = {
            'single': 14600,
            'married': 29200,
            'marriedSeparate': 14600,
            'headOfHousehold': 21900
        };
        return deductions[filingStatus] || deductions.single;
    }

    /**
     * Save form to storage
     */
    saveForm(form) {
        const formId = `${form.formType}-${Date.now()}`;
        form.formId = formId;
        this.forms.set(formId, form);
        
        // Also save to localStorage if available
        if (typeof localStorage !== 'undefined') {
            const existingForms = this.getAllForms();
            existingForms.push(form);
            localStorage.setItem('taxForms', JSON.stringify(existingForms));
        }
        
        return formId;
    }

    /**
     * Get all saved forms
     */
    getAllForms() {
        if (typeof localStorage !== 'undefined') {
            const formsJson = localStorage.getItem('taxForms');
            return formsJson ? JSON.parse(formsJson) : [];
        }
        return Array.from(this.forms.values());
    }

    /**
     * Get form by ID
     */
    getForm(formId) {
        if (this.forms.has(formId)) {
            return this.forms.get(formId);
        }
        
        // Try to find in localStorage
        if (typeof localStorage !== 'undefined') {
            const forms = this.getAllForms();
            return forms.find(f => f.formId === formId);
        }
        
        return null;
    }

    /**
     * Update form status
     */
    updateFormStatus(formId, status) {
        const form = this.getForm(formId);
        if (form) {
            form.status = status;
            form.lastModified = new Date().toISOString();
            this.saveForm(form);
        }
    }

    /**
     * Delete form
     */
    deleteForm(formId) {
        this.forms.delete(formId);
        
        if (typeof localStorage !== 'undefined') {
            const forms = this.getAllForms().filter(f => f.formId !== formId);
            localStorage.setItem('taxForms', JSON.stringify(forms));
        }
    }

    /**
     * Export form to PDF (placeholder - would need PDF library)
     */
    exportToPDF(formId) {
        const form = this.getForm(formId);
        if (!form) {
            throw new Error('Form not found');
        }

        // This would integrate with a PDF generation library like jsPDF
        console.log('Exporting form to PDF:', form);
        
        return {
            success: true,
            message: 'Form exported successfully',
            filename: `${form.formType}_${form.taxYear}.pdf`
        };
    }

    /**
     * Export form to JSON
     */
    exportToJSON(formId) {
        const form = this.getForm(formId);
        if (!form) {
            throw new Error('Form not found');
        }

        const json = JSON.stringify(form, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${form.formType}_${form.taxYear}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Validate form data
     */
    validateForm(formType, data) {
        const errors = [];

        switch (formType) {
            case '1099-MISC':
                if (!data.payerEIN) errors.push('Payer EIN is required');
                if (!data.recipientTIN) errors.push('Recipient TIN is required');
                break;
            case 'W-2':
                if (!data.employerEIN) errors.push('Employer EIN is required');
                if (!data.employeeSSN) errors.push('Employee SSN is required');
                break;
            case 'Schedule-C':
                if (!data.businessName) errors.push('Business name is required');
                break;
            case '1040':
                if (!data.ssn) errors.push('SSN is required');
                if (!data.filingStatus) errors.push('Filing status is required');
                break;
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaxFormsGenerator;
}
